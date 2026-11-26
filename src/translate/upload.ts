// Upload a PDF straight to object storage with the signed URLs from `POST /uploads/intent`:
// one PUT below 8MB, otherwise parts in parallel and `POST /uploads/complete`.
import { completeUpload, createUploadIntent, type UploadIntent } from '../api/pdf.ts'

const PART_CONCURRENCY = 4
const PART_RETRIES = 2

export class UploadError extends Error {
  /** The signed URL expired; start over with a new intent. */
  readonly expired: boolean
  constructor(message: string, expired = false) {
    super(message)
    this.name = 'UploadError'
    this.expired = expired
  }
}

function put(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
  onLoaded: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => onLoaded(e.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader('ETag'))
      else reject(new UploadError(`PUT ${xhr.status}`, xhr.status === 403))
    }
    xhr.onerror = () => reject(new UploadError('PUT network error'))
    xhr.ontimeout = () => reject(new UploadError('PUT timeout'))
    const abort = () => xhr.abort()
    signal.addEventListener('abort', abort, { once: true })
    xhr.onabort = () => reject(signal.reason ?? new Error('aborted'))
    xhr.send(body as Uint8Array<ArrayBuffer>)
  })
}

async function putWithRetry(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
  onLoaded: (bytes: number) => void,
  signal: AbortSignal,
): Promise<string | null> {
  let last: unknown
  for (let attempt = 0; attempt <= PART_RETRIES; attempt++) {
    onLoaded(0)
    try {
      return await put(url, headers, body, onLoaded, signal)
    } catch (e) {
      if (signal.aborted || (e instanceof UploadError && e.expired)) throw e
      last = e
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw last
}

async function putAll(
  intent: UploadIntent,
  bytes: Uint8Array,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const headers = intent.headers ?? {}
  const total = bytes.byteLength
  if (intent.mode === 'single') {
    if (!intent.uploadUrl) throw new UploadError('intent without uploadUrl')
    await putWithRetry(intent.uploadUrl, headers, bytes, (n) => onProgress(n / total), signal)
    return
  }
  const { parts, partSizeBytes, uploadId } = intent
  if (!parts?.length || !partSizeBytes || !uploadId) throw new UploadError('intent without parts')
  const loaded = new Map<number, number>()
  const report = () => onProgress([...loaded.values()].reduce((a, b) => a + b, 0) / total)
  const etags: { partNumber: number; etag: string }[] = []
  let next = 0
  const worker = async () => {
    while (next < parts.length) {
      const part = parts[next++]!
      const start = (part.partNumber - 1) * partSizeBytes
      const etag = await putWithRetry(
        part.url,
        headers,
        bytes.subarray(start, start + partSizeBytes),
        (n) => {
          loaded.set(part.partNumber, n)
          report()
        },
        signal,
      )
      if (!etag) throw new UploadError(`part ${part.partNumber} without ETag`)
      etags.push({ partNumber: part.partNumber, etag })
    }
  }
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker))
  etags.sort((a, b) => a.partNumber - b.partNumber)
  await completeUpload(intent.objectKey, uploadId, etags)
}

/** Returns the object key to create the task with. `onProgress` gets 0..1. */
export async function uploadPdf(
  filename: string,
  bytes: Uint8Array,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const intent = await createUploadIntent(filename, bytes.byteLength, signal)
    try {
      await putAll(intent, bytes, onProgress, signal)
      return intent.objectKey
    } catch (e) {
      if (attempt === 0 && e instanceof UploadError && e.expired) continue
      throw e
    }
  }
}
