// PDF API: direct upload to object storage, tasks, results.
import { authedCall } from '../auth/session.ts'

export type Mode = 'dual' | 'mono'
export type TaskStatus = 'PENDING' | 'TRANSLATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface UploadIntent {
  objectKey: string
  mode: 'single' | 'multipart'
  uploadUrl?: string
  uploadId?: string
  partSizeBytes?: number
  parts?: { partNumber: number; url: string }[]
  /** Signed together with the URL; must be sent as is. */
  headers?: Record<string, string>
  expiresInSeconds: number
}

export interface TaskConfig {
  sourceLang: string
  targetLang: string
  model: string
  noDual?: boolean
  noMono?: boolean
}

export interface PdfTask {
  id: string
  status: TaskStatus
  progress: number
  fileName: string
  pageCount?: number
  errorCode?: string | null
  retryCount: number
  maxRetries: number
  queuePosition?: { position: number; totalWaiting: number; estimatedWaitTime?: number }
}

const BASE = '/api/v1/pdf'

export const createUploadIntent = (filename: string, fileSize: number, signal?: AbortSignal) =>
  authedCall<UploadIntent>(`${BASE}/uploads/intent`, { body: { filename, fileSize }, signal })

export const completeUpload = (objectKey: string, uploadId: string, parts: { partNumber: number; etag: string }[]) =>
  authedCall<unknown>(`${BASE}/uploads/complete`, { body: { objectKey, uploadId, parts } })

export const createTask = (objectKey: string, filename: string, config: TaskConfig) =>
  authedCall<PdfTask>(`${BASE}/tasks`, { body: { objectKey, filename, config }, timeoutMs: 120_000 })

export const getTask = (id: string) => authedCall<PdfTask>(`${BASE}/task/${encodeURIComponent(id)}`)

export const cancelTask = (id: string) => authedCall<unknown>(`${BASE}/task/${encodeURIComponent(id)}/cancel`, { body: {} })

export const retryTask = (id: string) => authedCall<PdfTask>(`${BASE}/task/${encodeURIComponent(id)}/retry`, { body: {} })

export const getDownloadURL = (id: string, mode: Mode) =>
  authedCall<{ url: string; expiresIn: number }>(`${BASE}/task/${encodeURIComponent(id)}/download/${mode}`)
