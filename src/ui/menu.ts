// 椰子翻译 ▸ 双语对照版 / 纯译文版, in the item context menu and behind the reader's toolbar button.
import type { Mode } from '../api/pdf.ts'
import { t } from '../i18n/index.ts'
import { model, targetLang } from '../settings.ts'
import { existingOutput, isOutput, reusableTask, sourceOf } from '../translate/outputs.ts'
import { activeJob, addSkipped, startJob, type SkipReason } from '../translate/jobs.ts'
import { xul } from './dom.ts'
import { showPopup } from './popup.ts'
import { openSettings } from './settings-pane.ts'

const ID = 'cocotranslate-itemmenu'

interface Resolved {
  /** source PDFs to translate, one per paper */
  pdfs: ZoteroItem[]
  /** selected items that cannot be translated, and why */
  skipped: { item: ZoteroItem; why: SkipReason }[]
}

/** The PDFs a selection stands for: selected PDF attachments, or each regular item's first PDF that is not a translation. */
export function resolve(items: ZoteroItem[]): Resolved {
  const pdfs: ZoteroItem[] = []
  const skipped: Resolved['skipped'] = []
  const seen = new Set<number>()
  const add = (pdf: ZoteroItem) => {
    if (seen.has(pdf.id)) return
    seen.add(pdf.id)
    pdfs.push(pdf)
  }
  for (const item of items) {
    if (item.isRegularItem()) {
      const pdf = firstSourcePdf(item)
      if (pdf) add(pdf)
      else skipped.push({ item, why: 'noPdf' })
    } else if (item.isAttachment() && item.isPDFAttachment()) {
      if (isOutput(item)) skipped.push({ item, why: 'isOutput' })
      else add(item)
    } else {
      skipped.push({ item, why: 'notPdf' })
    }
  }
  return { pdfs, skipped }
}

export function firstSourcePdf(item: ZoteroItem): ZoteroItem | null {
  for (const id of item.getAttachments()) {
    const att = Zotero.Items.get(id)
    if (att && att.isPDFAttachment() && !isOutput(att)) return att
  }
  return null
}

/**
 * Starts translations for the selection. One paper that already has this translation opens it;
 * several list the ones left out. The other mode of an earlier task is downloaded, not translated.
 */
export function translate(items: ZoteroItem[], mode: Mode, as?: { lang: string; model: string }): void {
  const { pdfs, skipped } = resolve(items)
  const many = pdfs.length + skipped.length > 1
  const lang = as?.lang ?? targetLang()
  const chosenModel = as?.model ?? model()
  let listed = false
  for (const pdf of pdfs) {
    const existing = existingOutput(pdf, mode, lang)
    if (existing) {
      if (!many) {
        void Zotero.Reader.open(existing.id)
        return
      }
      addSkipped(pdf, mode, 'exists', existing.id)
      listed = true
      continue
    }
    // already under way: it is in the list
    if (activeJob(pdf.id, mode, lang)) {
      listed = true
      continue
    }
    startJob(pdf, mode, lang, chosenModel, reusableTask(pdf, mode, lang, chosenModel))
    listed = true
  }
  if (many) for (const { item, why } of skipped) addSkipped(item, mode, why)
  if (listed) showPopup()
}

export function openSource(output: ZoteroItem): void {
  const src = sourceOf(output)
  if (src) void Zotero.Reader.open(src.id)
}

/** Fills a menupopup with the translate commands for `items`. */
export function fillMenu(popup: Element, items: ZoteroItem[]): void {
  const doc = popup.ownerDocument
  popup.replaceChildren()
  const item = (attrs: Record<string, string>, onCommand?: () => void) => {
    const el = xul(doc, 'menuitem', attrs)
    if (onCommand) el.addEventListener('command', onCommand)
    popup.append(el)
  }
  const { pdfs, skipped } = resolve(items)
  const single = items.length === 1 ? items[0]! : null
  if (single && single.isAttachment() && isOutput(single)) {
    item({ label: t.menuIsOutput, disabled: 'true' })
    if (sourceOf(single)) item({ label: t.menuOpenSourcePdf }, () => openSource(single))
    return
  }
  if (pdfs.length === 0) {
    const why = single ? (single.isRegularItem() ? t.menuNoPdfItem : t.menuNotPdf) : t.menuNoPdfAll
    item({ label: why, disabled: 'true' })
    return
  }
  const lang = targetLang()
  const one = pdfs.length === 1 && skipped.length === 0 ? pdfs[0]! : null
  for (const mode of ['dual', 'mono'] as const) {
    const attrs: Record<string, string> = { label: t.modeVersion(mode) }
    if (one && existingOutput(one, mode, lang)) attrs.acceltext = t.menuOpenExisting
    item(attrs, () => translate(items, mode))
  }
  popup.append(xul(doc, 'menuseparator'))
  item({ label: t.settings }, openSettings)
}

function refresh(win: ZoteroMainWindow): void {
  const doc = win.document
  const menu = doc.getElementById(ID)
  const popup = doc.getElementById(`${ID}-popup`)
  if (!menu || !popup) return
  const items = win.ZoteroPane.getSelectedItems()
  const { pdfs, skipped } = resolve(items)
  const n = pdfs.length + skipped.length
  menu.setAttribute('label', n > 1 ? t.menuCount(n) : t.brand)
  fillMenu(popup, items)
}

export function addMenu(win: ZoteroMainWindow): void {
  const doc = win.document
  const itemMenu = doc.getElementById('zotero-itemmenu')
  if (!itemMenu || doc.getElementById(ID)) return
  const sep = xul(doc, 'menuseparator', { id: `${ID}-sep` })
  const menu = xul(doc, 'menu', {
    id: ID,
    label: t.brand,
    class: 'menu-iconic',
    image: 'chrome://cocotranslate/content/icons/coco-16.png',
  })
  const popup = xul(doc, 'menupopup', { id: `${ID}-popup` })
  menu.append(popup)
  itemMenu.append(sep, menu)
  itemMenu.addEventListener('popupshowing', onShowing)
}

function onShowing(e: Event): void {
  const target = e.target as Element
  if (target.id !== 'zotero-itemmenu') return
  const win = target.ownerDocument.defaultView as unknown as ZoteroMainWindow
  try {
    refresh(win)
  } catch (err) {
    Zotero.logError(err)
  }
}

export function removeMenu(win: ZoteroMainWindow): void {
  const doc = win.document
  doc.getElementById('zotero-itemmenu')?.removeEventListener('popupshowing', onShowing)
  doc.getElementById(ID)?.remove()
  doc.getElementById(`${ID}-sep`)?.remove()
}
