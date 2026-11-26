// The 椰子翻译 section of the item pane (right column). For a paper or its PDF: translations under
// way, the last failure, the translations it has, and buttons for the missing modes. For a
// translation: what it is, and the way back to the original.
import type { Mode } from '../api/pdf.ts'
import { onPrefChange } from '../env.ts'
import { t } from '../i18n/index.ts'
import { LANG_NAMES, model, modelName, onPlansChange, targetLang } from '../settings.ts'
import { FAILURES, failureTitle } from '../translate/errors.ts'
import { activeJob, allJobs, askCancel, onJobsChange, RUNNING, type Job } from '../translate/jobs.ts'
import { existingOutput, isOutput, outputMeta, outputsOf, sourceOf, type OutputMeta } from '../translate/outputs.ts'
import { h } from './dom.ts'
import { openLogin } from './login-dialog.ts'
import { firstSourcePdf, openSource, translate } from './menu.ts'
import { bar, failActions, progressText, showPopup } from './popup.ts'
import { openSettings } from './settings-pane.ts'

const PANE_ID = 'cocotranslate'
const MODES: Mode[] = ['dual', 'mono']
const other = (m: Mode): Mode => (m === 'dual' ? 'mono' : 'dual')
const langName = (l: string) => LANG_NAMES[l] ?? l
const when = (iso: string) =>
  new Date(iso).toLocaleString(t.intl, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** refresh() of every section on screen (one per window, two with a reader tab open) */
const refreshers = new Map<HTMLElement, () => Promise<void>>()

const shows = (item: ZoteroItem) => item.isRegularItem() || (item.isAttachment() && item.isPDFAttachment())

function render(doc: Document, body: HTMLElement, item: ZoteroItem): void {
  const pdf = item.isAttachment() ? item : firstSourcePdf(item)
  const content =
    item.isAttachment() && isOutput(item)
      ? outputView(doc, item)
      : pdf
        ? sourceView(doc, pdf)
        : [h(doc, 'div', { class: 'hint' }, t.paneNoPdf)]
  body.replaceChildren(h(doc, 'div', { class: 'cocotranslate-sec' }, content))
}

function outputView(doc: Document, out: ZoteroItem): (HTMLElement | null)[] {
  const meta = outputMeta(out)
  const src = sourceOf(out)
  const missing = meta && src && missingOther(src, meta) ? other(meta.mode) : null
  return [
    h(
      doc,
      'div',
      { class: 'hint' },
      meta
        ? [t.paneThisIs(meta.mode), t.translateTo(langName(meta.lang)), modelName(meta.model), when(meta.at)].join(t.dot)
        : t.paneThisIsOutput,
    ),
    src
      ? h(
          doc,
          'div',
          { class: 'go' },
          h(doc, 'button', { class: 'btn', onclick: () => openSource(out) }, t.openOriginal),
          missing
            ? h(
                doc,
                'button',
                { class: 'btn', onclick: () => translate([src], missing, { lang: meta!.lang, model: meta!.model }) },
                t.paneAlso(missing),
              )
            : null,
        )
      : null,
  ]
}

/** The other mode of this translation is neither in the library nor on its way. */
function missingOther(src: ZoteroItem, meta: OutputMeta): boolean {
  const m = other(meta.mode)
  return !existingOutput(src, m, meta.lang) && !activeJob(src.id, m, meta.lang)
}

function sourceView(doc: Document, pdf: ZoteroItem): (HTMLElement | null)[] {
  const lang = targetLang()
  const jobs = allJobs().filter((j) => j.pdfID === pdf.id && j.stage !== 'skip')
  const live = jobs.filter((j) => RUNNING.has(j.stage) || j.stage === 'login')
  const lastFail = live.length ? undefined : jobs.findLast((j) => j.stage === 'fail' && j.failure)
  const outs = outputsOf(pdf).reverse()
  const missing = MODES.filter((m) => !outs.some((o) => o.meta.mode === m && o.meta.lang === lang) && !activeJob(pdf.id, m, lang))
  return [
    ...live.map((j) => liveBlock(doc, j)),
    lastFail ? failBlock(doc, lastFail) : null,
    ...outs.map(({ item, meta }) =>
      h(
        doc,
        'div',
        { class: 'out' },
        h(
          doc,
          'div',
          { class: 'o' },
          h(doc, 'div', {}, `${t.modeName(meta.mode)}${t.dot}${langName(meta.lang)}`),
          h(doc, 'div', { class: 'm', title: item.getDisplayTitle() }, `${when(meta.at)}${t.dot}${item.getDisplayTitle()}`),
        ),
        h(doc, 'button', { class: 'btn', onclick: () => void Zotero.Reader.open(item.id) }, t.open),
      ),
    ),
    missing.length
      ? h(
          doc,
          'div',
          { class: 'go' },
          missing.map((m) => h(doc, 'button', { class: 'btn', onclick: () => translate([pdf], m) }, t.paneTranslate(m))),
        )
      : null,
    missing.length
      ? h(
          doc,
          'div',
          { class: 'hint' },
          `${t.translateTo(langName(lang))}${t.dot}${modelName(model())}${t.dot}`,
          h(doc, 'button', { class: 'lnk', onclick: () => openSettings() }, t.change),
        )
      : null,
  ]
}

function liveBlock(doc: Document, job: Job): HTMLElement {
  const waiting = job.stage === 'login'
  return h(
    doc,
    'div',
    { class: 'run' },
    h(doc, 'div', {}, `${t.modeName(job.mode)}${t.dot}${waiting ? t.waitingLogin : progressText(job)}`),
    waiting ? null : bar(doc, job),
    h(
      doc,
      'div',
      { class: 'acts' },
      waiting
        ? h(doc, 'button', { class: 'btn', onclick: () => void openLogin().catch(() => {}) }, t.logIn)
        : h(
            doc,
            'button',
            {
              class: 'lnk',
              onclick: () => {
                askCancel(job)
                // a subscriber confirms there
                if (job.confirmCancel) showPopup()
              },
            },
            t.cancel,
          ),
    ),
  )
}

function failBlock(doc: Document, job: Job): HTMLElement {
  const f = job.failure!
  return h(
    doc,
    'div',
    { class: 'run' },
    h(doc, 'div', { class: 'err' }, `${t.modeName(job.mode)}${t.dot}${failureTitle(f)}`),
    h(doc, 'div', { class: 'hint' }, FAILURES[f.key].text(f.facts)),
    h(doc, 'div', { class: 'acts' }, failActions(doc, job)),
  )
}

export function registerItemPane(): () => void {
  const id = Zotero.ItemPaneManager.registerSection({
    paneID: PANE_ID,
    pluginID: 'cocotranslate@cocotranslate.com',
    header: { l10nID: 'cocotranslate-section-header', icon: 'chrome://cocotranslate/content/icons/coco-16.svg' },
    sidenav: { l10nID: 'cocotranslate-section-sidenav', icon: 'chrome://cocotranslate/content/icons/coco-20.svg' },
    onInit: ({ body, refresh }) => {
      refreshers.set(body, refresh)
    },
    onDestroy: ({ body }) => {
      refreshers.delete(body)
    },
    onItemChange: ({ item, setEnabled }) => setEnabled(shows(item)),
    onRender: ({ doc, body, item }) => {
      try {
        render(doc, body, item)
      } catch (e) {
        Zotero.logError(e)
      }
    },
  })
  if (!id) return () => {}

  // Progress changes many times a second while uploading; redraw at most twice a second.
  let timer: ReturnType<typeof setTimeout> | null = null
  const refreshAll = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      for (const refresh of refreshers.values()) void refresh().catch((e: unknown) => Zotero.logError(e))
    }, 500)
  }
  const offs = [
    onJobsChange(refreshAll),
    onPlansChange(refreshAll),
    onPrefChange(['targetLang', 'model', 'outputs'], refreshAll),
  ]
  // translations moved to the trash, restored, or added elsewhere
  const notifier = Zotero.Notifier.registerObserver({ notify: refreshAll }, ['item'], 'cocotranslate-pane')
  return () => {
    if (timer) clearTimeout(timer)
    for (const off of offs) off()
    Zotero.Notifier.unregisterObserver(notifier)
    Zotero.ItemPaneManager.unregisterSection(id)
    refreshers.clear()
  }
}
