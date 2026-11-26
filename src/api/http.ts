// JSON calls to the Coco API. Every response is `{ success, data }` or `{ success: false, error }`.

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** The request never got an answer from the server (offline, DNS, TLS, timeout). */
  get isNetwork(): boolean {
    return this.status === 0
  }
}

export interface CallOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ApiConfig {
  baseURL: string
  appVersion: string
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'QUOTA_EXCEEDED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'FILE_TOO_LARGE',
  429: 'RATE_LIMIT_EXCEEDED',
}

export async function callApi<T>(config: ApiConfig, path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Id': 'ZOTERO',
    'X-App-Version': config.appVersion,
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 30_000)
  const onAbort = () => timeout.abort()
  options.signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(config.baseURL + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
      credentials: 'omit',
      signal: timeout.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }

  const text = await response.text()
  let parsed: { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: Record<string, unknown> } }
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }

  if (!response.ok || parsed.success === false) {
    const err = parsed.error ?? {}
    throw new ApiError(
      response.status,
      err.code ?? CODE_BY_STATUS[response.status] ?? (response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'UNKNOWN_ERROR'),
      err.message ?? response.statusText,
      err.details ?? {},
    )
  }
  return parsed.data as T
}
