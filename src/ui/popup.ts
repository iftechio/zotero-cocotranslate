// The progress popup in the bottom-right corner of the main window (drawn by the plugin: Zotero's
// ProgressWindow cannot hold buttons or a progress bar). Closing it only hides it; translations go
// on, the toolbar button brings it back, and it comes back by itself for a few seconds when one
// finishes. Results nobody looked at stay until someone does.
import { isSubscriber } from '../account.ts'
import { isLoginPending, onLoginStateChange } from '../auth/login.ts'
import { t } from '../i18n/index.ts'
import { FAILURES, failureTitle } from '../translate/errors.ts'
import { queueText } from '../translate/format.ts'
import {
  allJobs,
  askCancel,
  cancel,
  dropWaitingForLogin,
  forgetFinished,
  keepGoing,
  onJobsChange,
  retry,
  RUNNING,
  type Job,
  type SkipReason,
} from '../translate/jobs.ts'
import { openWebPage } from '../web.ts'
import { h } from './dom.ts'
import { openLogin } from './login-dialog.ts'
import { openSettings } from './settings-pane.ts'

const ROOT_ID = 'cocotranslate-popup'
const AUTO_HIDE_MS = 8000

let open = false
/** open with nothing to show: the toolbar button was clicked with no translations */
let emptyCard = false
let hideTimer: ReturnType<typeof setTimeout> | null = null
let hovered = false
/** someone opened the popup or moved the mouse over it since it last appeared */
let attended = false
const lastStage = new Map<string, Job['stage']>()
/** jobs that finished while nobody was looking */
const unseen = new Set<string>()
const closeListeners = new Set<(byUser: boolean, running: number) => void>()
const renderListeners = new Set<() => void>()

export function skipText(why: SkipReason): string {
  return { noPdf: t.skipNoPdf, isOutput: t.skipIsOutput, notPdf: t.skipNotPdf, exists: t.skipExists }[why]
}

export function progressText(job: Job): string {
  const pct = Math.round(job.fraction * 100)
  switch (job.stage) {
    case 'upload':
      return t.uploading(pct)
    case 'queue':
      return job.offline ? t.offline : queueText(job.ahead, job.waitSec, isSubscriber())
    case 'translate':
      return job.offline ? t.offline : t.translating(pct)
    case 'fetch':
      return t.downloading(job.mode)
    case 'save':
      return t.saving
    default:
      return ''
  }
}

export function bar(doc: Document, job: Job): HTMLElement {
  // The backend reports progress in steps and can sit at 0% for a while; keep the bar moving until the first step.
  const indeterminate =
    job.stage === 'queue' || job.stage === 'fetch' || job.stage === 'save' || (job.stage === 'translate' && job.fraction === 0)
  const pct = Math.round(job.fraction * 100)
  return h(
    doc,
    'div',
    {
      class: `bar${indeterminate ? ' ind' : ''}${job.offline ? ' paused' : ''}`,
      role: 'progressbar',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': indeterminate ? null : pct,
    },
    h(doc, 'i', { style: indeterminate ? null : `width:${pct}%` }),
  )
}

function openResult(job: Job): void {
  if (job.resultID) void Zotero.Reader.open(job.resultID)
}

function reveal(job: Job): void {
  const win = Zotero.getMainWindow()
  if (win && job.resultID) void win.ZoteroPane.selectItem(job.resultID)
}

export function failActions(doc: Document, job: Job): HTMLElement[] {
  const f = job.failure!
  const copy = FAILURES[f.key]
  const out: HTMLElement[] = []
  const serverRetry = copy.phase === 'run' && Boolean(job.taskId)
  const canRetry = copy.retry === true && (!serverRetry || job.retries < job.maxRetries)
  if (copy.act === 'upgrade' || copy.act === 'subscribe' || copy.act === 'model') {
    out.push(
      h(doc, 'button', { class: 'btn pri', onclick: () => void openWebPage('/subscription/plans') }, copy.act === 'subscribe' ? t.goSubscribe : t.upgradePlan),
    )
  }
  if (copy.act === 'relogin') out.push(h(doc, 'button', { class: 'btn pri', onclick: () => void openLogin().then(() => retry(job), () => {}) }, t.logInAgain))
  if (canRetry) out.push(h(doc, 'button', { class: 'btn', onclick: () => void retry(job) }, t.retry))
  return out
}

function card(doc: Document, job: Job): HTMLElement[] {
  const fn = h(doc, 'div', { class: 'fn', title: job.title }, job.title)
  if (job.stage === 'login') {
    const waiting = isLoginPending()
    return [
      h(doc, 'div', { class: 'st' }, t.pleaseLogIn),
      fn,
      h(doc, 'div', { class: 'sub' }, waiting ? t.loginOpened : t.loginThenStart),
      h(
        doc,
        'div',
        { class: 'acts' },
        h(doc, 'button', { class: 'btn pri', onclick: () => void openLogin().catch(() => {}) }, waiting ? t.reopenLogin : t.logIn),
      ),
    ]
  }
  if (RUNNING.has(job.stage)) {
    return [
      h(doc, 'div', { class: 'st' }, t.translatingPdf(job.mode)),
      fn,
      h(doc, 'div', { class: 'sub' }, progressText(job)),
      bar(doc, job),
      job.confirmCancel
        ? h(
            doc,
            'div',
            { class: 'confirm' },
            t.cancelNoRefund,
            h(
              doc,
              'div',
              { class: 'acts' },
              h(doc, 'button', { class: 'btn', onclick: () => keepGoing(job) }, t.keepTranslating),
              h(doc, 'button', { class: 'btn pri', onclick: () => void cancel(job) }, t.cancelTranslation),
            ),
          )
        : h(doc, 'div', { class: 'acts' }, h(doc, 'button', { class: 'lnk', onclick: () => askCancel(job) }, t.cancel)),
    ]
  }
  if (job.stage === 'done') {
    return [
      h(doc, 'div', { class: 'st ok' }, t.done),
      fn,
      h(doc, 'div', { class: 'sub' }, job.standalone ? t.addedToLibrary(job.mode) : t.addedUnderItem(job.mode)),
      h(
        doc,
        'div',
        { class: 'acts' },
        h(doc, 'button', { class: 'lnk', onclick: () => reveal(job) }, t.showInLibrary),
        h(doc, 'button', { class: 'btn pri', onclick: () => openResult(job) }, t.openTranslation),
      ),
    ]
  }
  if (job.stage === 'fail' && job.failure) {
    const copy = FAILURES[job.failure.key]
    const detail = copy.detail?.(job.failure.facts)
    const outOfRetries = copy.retry && copy.phase === 'run' && job.retries >= job.maxRetries
    return [
      h(doc, 'div', { class: 'st err' }, failureTitle(job.failure)),
      fn,
      h(doc, 'div', { class: 'sub' }, copy.text(job.failure.facts)),
      detail ? h(doc, 'div', { class: 'sub detail' }, detail) : null,
      copy.phase === 'run'
        ? h(doc, 'div', { class: 'sub note' }, outOfRetries ? t.noChargeAfterRetries(job.maxRetries) : t.noCharge)
        : null,
      h(doc, 'div', { class: 'acts' }, failActions(doc, job)),
    ].filter((x): x is HTMLElement => x !== null)
  }
  if (job.stage === 'skip') {
    return [
      h(doc, 'div', { class: 'st' }, t.skipped),
      fn,
      h(doc, 'div', { class: 'sub' }, job.skipWhy ? skipText(job.skipWhy) : ''),
      job.existingID ? h(doc, 'div', { class: 'acts' }, h(doc, 'button', { class: 'btn', onclick: () => void Zotero.Reader.open(job.existingID!) }, t.openTranslation)) : null,
    ].filter((x): x is HTMLElement => x !== null)
  }
  return [
    h(doc, 'div', { class: 'st' }, t.cancelled),
    fn,
    h(doc, 'div', { class: 'acts' }, h(doc, 'button', { class: 'btn', onclick: () => void retry(job) }, t.restart)),
  ]
}

function row(doc: Document, job: Job): HTMLElement {
  let status: string
  let cls = ''
  let action: HTMLElement | null = null
  if (job.stage === 'login') status = t.waitingLogin
  else if (RUNNING.has(job.stage)) {
    status = progressText(job)
    action = h(doc, 'button', { class: 'btn sm', onclick: () => askCancel(job) }, t.cancel)
  } else if (job.stage === 'done') {
    status = t.finished
    cls = 'ok'
    action = h(doc, 'button', { class: 'btn sm', onclick: () => openResult(job) }, t.open)
  } else if (job.stage === 'fail' && job.failure) {
    status = t.failedRow(failureTitle(job.failure), FAILURES[job.failure.key].text(job.failure.facts))
    cls = 'err'
    if (FAILURES[job.failure.key].retry) action = h(doc, 'button', { class: 'btn sm', onclick: () => void retry(job) }, t.retry)
  } else if (job.stage === 'skip') {
    status = t.skippedRow(job.skipWhy ? skipText(job.skipWhy) : '')
    if (job.existingID) action = h(doc, 'button', { class: 'btn sm', onclick: () => void Zotero.Reader.open(job.existingID!) }, t.open)
  } else status = t.cancelled
  return h(
    doc,
    'div',
    { class: 'row' },
    h(doc, 'div', { class: 't', title: job.title }, job.title),
    h(doc, 'div', { class: 'a' }, action),
    h(doc, 'div', { class: `s ${cls}` }, status),
    RUNNING.has(job.stage) ? bar(doc, job) : null,
    job.confirmCancel
      ? h(
          doc,
          'div',
          { class: 'confirm' },
          t.cancelNoRefund,
          h(
            doc,
            'div',
            { class: 'acts' },
            h(doc, 'button', { class: 'btn sm', onclick: () => keepGoing(job) }, t.keepTranslating),
            h(doc, 'button', { class: 'btn sm pri', onclick: () => void cancel(job) }, t.cancelTranslation),
          ),
        )
      : null,
  )
}

function close(byUser: boolean): void {
  const running = allJobs().filter((j) => RUNNING.has(j.stage)).length
  open = false
  emptyCard = false
  // the element goes away under the mouse without a mouseleave
  hovered = false
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  if (byUser) unseen.clear()
  dropWaitingForLogin()
  forgetFinished((j) => unseen.has(j.id))
  render()
  for (const fn of closeListeners) fn(byUser, running)
}

function attend(): void {
  attended = true
  if (unseen.size) {
    unseen.clear()
    render()
  }
}

/** Opens the popup; `autoHide` when a finishing job brings it back by itself. */
export function showPopup(autoHide = false): void {
  open = true
  emptyCard = false
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = autoHide
    ? setTimeout(() => {
        hideTimer = null
        if (!hovered) close(false)
      }, AUTO_HIDE_MS)
    : null
  if (autoHide) attended = false
  else attend()
  render()
}

/** The toolbar button: open or close; with nothing to show, a short note on how to start. */
export function togglePopup(): void {
  if (open) return close(true)
  if (allJobs().length) return showPopup()
  open = true
  emptyCard = true
  attended = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (!hovered && emptyCard) close(false)
  }, 5000)
  render()
}

/** For the toolbar badge: translations running, and whether a failure is still unseen. */
export function popupSummary(): { running: number; unseenFailure: boolean } {
  const jobs = allJobs()
  return {
    running: jobs.filter((j) => RUNNING.has(j.stage)).length,
    unseenFailure: jobs.some((j) => j.stage === 'fail' && unseen.has(j.id)),
  }
}

export function onPopupClose(fn: (byUser: boolean, running: number) => void): () => void {
  closeListeners.add(fn)
  return () => closeListeners.delete(fn)
}

export function onPopupRender(fn: () => void): () => void {
  renderListeners.add(fn)
  return () => renderListeners.delete(fn)
}

function emptyBody(doc: Document): HTMLElement[] {
  return [
    h(doc, 'div', { class: 'sub' }, t.nothingRunning),
    h(
      doc,
      'div',
      { class: 'acts' },
      h(
        doc,
        'button',
        {
          class: 'btn',
          onclick: () => {
            close(true)
            openSettings()
          },
        },
        t.settings,
      ),
    ),
  ]
}

function renderIn(win: Window): void {
  const doc = win.document
  doc.getElementById(ROOT_ID)?.remove()
  const jobs = allJobs()
  if (!open || (jobs.length === 0 && !emptyCard)) return
  const running = jobs.filter((j) => RUNNING.has(j.stage)).length
  const header = h(
    doc,
    'div',
    { class: 'ph' },
    h(doc, 'img', { src: 'chrome://cocotranslate/content/icons/coco-32.png', alt: '' }),
    t.brand,
    jobs.length > 1 ? h(doc, 'span', { class: 'cnt' }, running ? t.countRunning(running) : t.countAll(jobs.length)) : null,
    h(doc, 'button', { class: 'x', title: t.close, 'aria-label': t.close, onclick: () => close(true) }, '×'),
  )
  const body =
    jobs.length === 0
      ? emptyBody(doc)
      : jobs.length === 1
        ? card(doc, jobs[0]!)
        : [h(doc, 'div', { class: 'list' }, jobs.map((j) => row(doc, j)))]
  const root = h(
    doc,
    'div',
    {
      id: ROOT_ID,
      role: 'status',
      'aria-live': 'polite',
      onmouseenter: () => {
        hovered = true
        if (!attended) attend()
      },
      onmouseleave: () => {
        hovered = false
      },
    },
    header,
    body,
  )
  doc.documentElement.append(root)
}

export function render(): void {
  const win = Zotero.getMainWindow()
  for (const w of Zotero.getMainWindows()) if (w !== win) w.document.getElementById(ROOT_ID)?.remove()
  if (win) renderIn(win)
  for (const fn of renderListeners) fn()
}

export function addStyles(win: Window): void {
  const doc = win.document
  if (doc.getElementById(`${ROOT_ID}-css`)) return
  doc.documentElement.append(
    h(doc, 'link', { id: `${ROOT_ID}-css`, rel: 'stylesheet', href: 'chrome://cocotranslate/content/window.css' }),
  )
}

export function removeFrom(win: Window): void {
  win.document.getElementById(ROOT_ID)?.remove()
  win.document.getElementById(`${ROOT_ID}-css`)?.remove()
}

/** Re-renders on every change, and brings the popup back when a job finishes while it is closed. */
export function watchJobs(): () => void {
  const offLogin = onLoginStateChange(render)
  const offJobs = onJobsChange(() => {
    let finishedUnwatched = false
    for (const job of allJobs()) {
      const before = lastStage.get(job.id)
      lastStage.set(job.id, job.stage)
      if (before === undefined || before === job.stage || (job.stage !== 'done' && job.stage !== 'fail')) continue
      if (!open || !attended) {
        unseen.add(job.id)
        finishedUnwatched = true
      }
    }
    if (finishedUnwatched && !open) showPopup(true)
    else render()
  })
  return () => {
    offLogin()
    offJobs()
  }
}
