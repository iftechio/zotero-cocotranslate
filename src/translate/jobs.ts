// One translation from right-click to saved attachment, and the list the popup shows.
//
//   login? → upload → queue → translate → fetch → save → done
//                                           ↘ fail / cancelled
//
// A job can also start at fetch, taking the other mode from an earlier task (every task renders
// both), or be a skip: a row in a multi-item list saying why that item was left out.
//
// Jobs that reached the server (have a taskId) are saved in a pref, so a Zotero restart picks them
// up again and still saves the result.
import { ApiError } from '../api/http.ts'
import {
  cancelTask,
  createTask,
  getDownloadURL,
  getTask,
  retryTask,
  type Mode,
  type PdfTask,
} from '../api/pdf.ts'
import { isSubscriber } from '../account.ts'
import { randomToken } from '../auth/pkce.ts'
import { isSignedIn, LoginRequired, onSessionChange } from '../auth/session.ts'
import { log, pref, setPref } from '../env.ts'
import { modelName, modelTier } from '../settings.ts'
import { admitFailure, MAX_MB, MAX_PAGES, runFailure, type Failure, type FailureFacts } from './errors.ts'
import { filenameFromDisposition, filenameFromSignedURL, resultFilename } from './filename.ts'
import { saveOutput } from './outputs.ts'
import { uploadPdf, UploadError } from './upload.ts'

/** why an item of a multi-item selection was left out */
export type SkipReason = 'noPdf' | 'isOutput' | 'notPdf' | 'exists'

export type Stage = 'login' | 'upload' | 'queue' | 'translate' | 'fetch' | 'save' | 'done' | 'fail' | 'cancelled' | 'skip'
export const RUNNING: ReadonlySet<Stage> = new Set(['upload', 'queue', 'translate', 'fetch', 'save'])

export interface Job {
  id: string
  pdfID: number
  title: string
  filename: string
  /** the source PDF has no parent item, so the translation is saved next to it instead of under a parent */
  standalone: boolean
  mode: Mode
  lang: string
  model: string
  stage: Stage
  /** 0..1 while uploading or translating */
  fraction: number
  ahead?: number
  waitSec?: number
  taskId?: string
  failure?: Failure
  /** server-side retries used / allowed */
  retries: number
  maxRetries: number
  offline: boolean
  /** waiting for the user to confirm cancelling (subscribers only) */
  confirmCancel: boolean
  resultID?: number
  /** fetching this mode from an earlier task instead of translating */
  reusedFrom?: string
  /** why a skipped item was left out, and the translation it already has */
  skipWhy?: SkipReason
  existingID?: number
}

const POLL_MS = 2500
const OFFLINE_POLL_MS = 5000

const jobs: Job[] = []
const aborts = new Map<string, AbortController>()
const listeners = new Set<() => void>()

export function allJobs(): readonly Job[] {
  return jobs
}

export function onJobsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function changed(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      Zotero.logError(e)
    }
  }
}

function update(job: Job, patch: Partial<Job>): void {
  Object.assign(job, patch)
  if (patch.taskId !== undefined || patch.stage !== undefined) persist()
  changed()
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })

function waitForSignIn(signal: AbortSignal): Promise<void> {
  if (isSignedIn()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const off = onSessionChange((signedIn) => {
      if (!signedIn) return
      off()
      resolve()
    })
    signal.addEventListener('abort', () => {
      off()
      reject(signal.reason)
    })
  })
}

/** The paper's title for an item or one of its attachments. */
export function titleOf(item: ZoteroItem): string {
  const parent = item.parentItemID ? Zotero.Items.get(item.parentItemID) : null
  return (parent || item).getDisplayTitle() || item.attachmentFilename || ''
}

/** A translation of this PDF into this mode and language that has not ended yet. */
export function activeJob(pdfID: number, mode: Mode, lang: string): Job | undefined {
  return jobs.find((j) => j.pdfID === pdfID && j.mode === mode && j.lang === lang && (RUNNING.has(j.stage) || j.stage === 'login'))
}

/** Translates `pdf`, or with `reuseTask` downloads this mode from that earlier task. */
export function startJob(pdf: ZoteroItem, mode: Mode, lang: string, model: string, reuseTask?: string | null): Job {
  const job: Job = {
    id: randomToken(8),
    pdfID: pdf.id,
    title: titleOf(pdf),
    filename: pdf.attachmentFilename,
    standalone: !pdf.parentItemID,
    mode,
    lang,
    model,
    stage: !isSignedIn() ? 'login' : reuseTask ? 'fetch' : 'upload',
    fraction: 0,
    retries: 0,
    maxRetries: 3,
    offline: false,
    confirmCancel: false,
  }
  if (reuseTask) {
    job.taskId = reuseTask
    job.reusedFrom = reuseTask
    log(`taking ${mode} from task ${reuseTask} for item ${pdf.id}`)
  }
  jobs.push(job)
  changed()
  void run(job)
  return job
}

/**
 * A row saying an item of a multi-item selection was left out, and why. A source PDF goes by its
 * paper's title; anything else by its own, so a translation does not look like its original.
 */
export function addSkipped(item: ZoteroItem, mode: Mode, why: SkipReason, existingID?: number): void {
  jobs.push({
    id: randomToken(8),
    pdfID: item.id,
    title: existingID ? titleOf(item) : item.getDisplayTitle() || item.attachmentFilename || '',
    filename: item.attachmentFilename || '',
    standalone: !item.parentItemID,
    mode,
    lang: '',
    model: '',
    stage: 'skip',
    fraction: 0,
    retries: 0,
    maxRetries: 0,
    offline: false,
    confirmCancel: false,
    skipWhy: why,
    existingID,
  })
  changed()
}

class DownloadError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`download ${status}`)
    this.status = status
  }
}

/** The earlier task, or its file in storage, is no longer there to take a mode from. */
const isGone = (e: unknown) =>
  (e instanceof ApiError && !e.isNetwork && e.status < 500 && e.status !== 429) || (e instanceof DownloadError && e.status < 500)

/** what a refusal names: the model asked for and its quota bucket */
const modelFacts = (job: Job): FailureFacts => ({ modelName: modelName(job.model), tier: modelTier(job.model) })

async function run(job: Job): Promise<void> {
  const abort = new AbortController()
  aborts.set(job.id, abort)
  const { signal } = abort
  try {
    for (;;) {
      try {
        if (!job.taskId) await admit(job, signal)
        if (job.taskId) await follow(job, signal)
        return
      } catch (e) {
        if (e instanceof LoginRequired) {
          update(job, { stage: 'login' })
          await waitForSignIn(signal)
          // with a task, pick it up where it is
          update(job, { stage: job.taskId ? 'queue' : 'upload' })
          continue
        }
        if (job.reusedFrom && !signal.aborted && isGone(e)) {
          log(`cannot take ${job.mode} from task ${job.reusedFrom}: ${String(e)}`)
          update(job, { taskId: undefined, reusedFrom: undefined, stage: 'upload', fraction: 0 })
          continue
        }
        throw e
      }
    }
  } catch (e) {
    if (signal.aborted) return
    if (e instanceof ApiError) update(job, { stage: 'fail', failure: admitFailure(e, modelFacts(job)) })
    else if (e instanceof UploadError) update(job, { stage: 'fail', failure: { key: 'network', facts: {} } })
    else {
      Zotero.logError(e)
      update(job, { stage: 'fail', failure: { key: job.taskId ? 'internal' : 'network', facts: {} } })
    }
  } finally {
    aborts.delete(job.id)
  }
}

/** Local checks, upload, and `POST /tasks`. Ends with job.taskId set or a failure. */
async function admit(job: Job, signal: AbortSignal): Promise<void> {
  if (!isSignedIn()) throw new LoginRequired()
  const pdf = Zotero.Items.get(job.pdfID)
  const path = pdf ? await pdf.getFilePathAsync() : false
  if (!pdf || !path) return update(job, { stage: 'fail', failure: { key: 'missing', facts: {} } })
  const { size } = await IOUtils.stat(path)
  if (size > MAX_MB * 1024 * 1024) return update(job, { stage: 'fail', failure: { key: 'size', facts: {} } })
  const pages = await pageCount(pdf)
  if (signal.aborted) return
  if (pages !== null && pages > MAX_PAGES) return update(job, { stage: 'fail', failure: { key: 'pages', facts: { pages } } })

  update(job, { stage: 'upload', fraction: 0, failure: undefined })
  const bytes = await IOUtils.read(path)
  const objectKey = await uploadPdf(job.filename, bytes, (f) => update(job, { fraction: f }), signal)
  if (signal.aborted) return
  const task = await createTask(objectKey, job.filename, { sourceLang: 'auto', targetLang: job.lang, model: job.model })
  log(`task ${task.id} created for item ${job.pdfID} (${job.mode})`)
  update(job, { taskId: task.id })
  applyTask(job, task)
}

/** Read by Zotero's own PDF worker; null when it cannot tell (encrypted, damaged): the server decides then. */
async function pageCount(pdf: ZoteroItem): Promise<number | null> {
  try {
    const { totalPages } = await Zotero.PDFWorker.getFullText(pdf.id, 1, true)
    return typeof totalPages === 'number' ? totalPages : null
  } catch (e) {
    log(`page count of item ${pdf.id}: ${String(e)}`)
    return null
  }
}

function applyTask(job: Job, task: PdfTask): void {
  const patch: Partial<Job> = { offline: false, retries: task.retryCount ?? job.retries, maxRetries: task.maxRetries ?? job.maxRetries }
  switch (task.status) {
    case 'PENDING':
      Object.assign(patch, { stage: 'queue', ahead: task.queuePosition?.position, waitSec: task.queuePosition?.estimatedWaitTime })
      break
    case 'TRANSLATING':
      Object.assign(patch, { stage: 'translate', fraction: Math.max(0, Math.min(1, (task.progress ?? 0) / 100)) })
      break
    case 'FAILED':
      Object.assign(patch, { stage: 'fail', failure: runFailure(task.errorCode) })
      break
    case 'CANCELLED':
      Object.assign(patch, { stage: 'cancelled' })
      break
    case 'COMPLETED':
      Object.assign(patch, { stage: 'fetch' })
      break
  }
  update(job, patch)
}

/** Polls the task until it ends, then downloads and saves the result. */
async function follow(job: Job, signal: AbortSignal): Promise<void> {
  while (!signal.aborted && (job.stage === 'queue' || job.stage === 'translate' || job.stage === 'upload')) {
    await sleep(job.offline ? OFFLINE_POLL_MS : POLL_MS, signal)
    if (signal.aborted) return
    try {
      applyTask(job, await getTask(job.taskId!))
    } catch (e) {
      if (e instanceof ApiError && (e.isNetwork || e.status >= 500 || e.status === 429)) {
        if (!job.offline) update(job, { offline: true })
        continue
      }
      throw e
    }
  }
  if (signal.aborted || job.stage !== 'fetch') return

  const { url } = await getDownloadURL(job.taskId!, job.mode)
  const response = await fetch(url, { signal, credentials: 'omit' })
  if (!response.ok) throw new DownloadError(response.status)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const filename =
    filenameFromDisposition(response.headers.get('Content-Disposition')) ??
    filenameFromSignedURL(url) ??
    resultFilename(job.filename, job.mode)

  update(job, { stage: 'save' })
  const pdf = Zotero.Items.get(job.pdfID)
  if (!pdf) throw new Error('source item is gone')
  const att = await saveOutput(pdf, filename, bytes, { mode: job.mode, lang: job.lang, model: job.model, taskId: job.taskId! })
  log(`saved ${filename} as item ${att.id}`)
  update(job, { stage: 'done', resultID: att.id })
  if (pref('autoOpen', false)) void Zotero.Reader.open(att.id)
}

/** Subscribers confirm first because used quota is not refunded; free users cancel at once, like on the web. */
export function askCancel(job: Job): void {
  if (isSubscriber() && !job.reusedFrom) update(job, { confirmCancel: true })
  else void cancel(job)
}

export function keepGoing(job: Job): void {
  update(job, { confirmCancel: false })
}

export async function cancel(job: Job): Promise<void> {
  aborts.get(job.id)?.abort(new Error('cancelled'))
  update(job, { stage: 'cancelled', confirmCancel: false })
  // a finished earlier task: nothing to stop
  if (job.taskId && !job.reusedFrom) {
    try {
      await cancelTask(job.taskId)
    } catch (e) {
      log(`cancel ${job.taskId} failed: ${String(e)}`)
    }
  }
}

/** Retry after a failure: on the server for failed tasks, from the start for refusals. */
export async function retry(job: Job): Promise<void> {
  if (job.reusedFrom) {
    update(job, { taskId: job.reusedFrom, failure: undefined, stage: isSignedIn() ? 'fetch' : 'login' })
    void run(job)
    return
  }
  if (job.taskId && job.stage === 'fail' && job.failure && job.retries < job.maxRetries) {
    try {
      const task = await retryTask(job.taskId)
      update(job, { failure: undefined })
      applyTask(job, task)
      void run(job)
    } catch (e) {
      if (e instanceof ApiError) update(job, { failure: admitFailure(e, modelFacts(job)) })
      else Zotero.logError(e)
    }
    return
  }
  update(job, { taskId: undefined, failure: undefined, stage: isSignedIn() ? 'upload' : 'login', fraction: 0 })
  void run(job)
}

/** Drops finished jobs from the list (the popup was closed), except those `keep` holds on to. */
export function forgetFinished(keep: (job: Job) => boolean = () => false): void {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const job = jobs[i]!
    if (!RUNNING.has(job.stage) && job.stage !== 'login' && !keep(job)) jobs.splice(i, 1)
  }
  changed()
}

/** Waiting for login counts as given up when the popup is closed. */
export function dropWaitingForLogin(): void {
  for (const job of jobs) {
    if (job.stage === 'login') {
      aborts.get(job.id)?.abort(new Error('closed'))
      job.stage = 'cancelled'
    }
  }
  changed()
}

interface SavedJob {
  id: string
  pdfID: number
  title: string
  filename: string
  mode: Mode
  lang: string
  model: string
  taskId: string
  reusedFrom?: string
}

function persist(): void {
  const saved: SavedJob[] = jobs
    .filter((j) => j.taskId && (RUNNING.has(j.stage) || j.stage === 'login'))
    .map(({ id, pdfID, title, filename, mode, lang, model, taskId, reusedFrom }) => ({
      id,
      pdfID,
      title,
      filename,
      mode,
      lang,
      model,
      taskId: taskId!,
      reusedFrom,
    }))
  setPref('activeJobs', JSON.stringify(saved))
}

/** After a restart: follow tasks that were still running. */
export function resumeSavedJobs(): void {
  let saved: SavedJob[] = []
  try {
    saved = JSON.parse(pref('activeJobs', '[]')) as SavedJob[]
  } catch {
    return
  }
  for (const s of saved) {
    if (jobs.some((j) => j.id === s.id)) continue
    const pdf = Zotero.Items.get(s.pdfID)
    const job: Job = { ...s, standalone: !(pdf && pdf.parentItemID), stage: 'queue', fraction: 0, retries: 0, maxRetries: 3, offline: false, confirmCancel: false }
    jobs.push(job)
    log(`resuming task ${s.taskId}`)
    void run(job)
  }
  if (saved.length) changed()
}

export function stopAll(): void {
  for (const a of aborts.values()) a.abort(new Error('shutdown'))
  aborts.clear()
}
