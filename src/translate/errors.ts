// Why a translation did not happen, and what the popup says about it. The wording lives in
// i18n/*.ts and follows the web site's.
import type { QuotaTier } from '../api/account.ts'
import type { ApiError } from '../api/http.ts'
import { t } from '../i18n/index.ts'

export const MAX_PAGES = 150
export const MAX_MB = 100

/** admit = refused before it started, nothing was charged; run = failed after it started, the backend refunds it. */
export type Phase = 'admit' | 'run'
export type Action = 'upgrade' | 'subscribe' | 'model' | 'split' | 'help' | 'relogin' | 'feedback'

export type FailureKey =
  | 'network'
  | 'pages'
  | 'size'
  | 'missing'
  | 'parse'
  | 'quota'
  | 'quotaEmpty'
  | 'noAccess'
  | 'model'
  | 'scan'
  | 'undecodable'
  | 'already'
  | 'auth'
  | 'unavailable'
  | 'internal'

export interface FailureFacts {
  pages?: number
  /** the quota bucket of the model asked for */
  tier?: QuotaTier
  modelName?: string
  estimatedTokens?: number
  bucketRemaining?: number
}

export interface Failure {
  key: FailureKey
  facts: FailureFacts
}

interface FailureCopy {
  phase: Phase
  title?: (x: FailureFacts) => string
  text: (x: FailureFacts) => string
  detail?: (x: FailureFacts) => string | null
  retry?: boolean
  act?: Action
}

/** Compact like on the web site: 144000 → 14.4万 / 144K */
export function formatTokens(n: number): string {
  return new Intl.NumberFormat(t.intl, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export const tierName = (tier: QuotaTier | undefined): string => (tier === 'TOP' ? t.tierTop : t.tierAdvanced)

const quotaDetail = (x: FailureFacts): string | null => {
  if (x.estimatedTokens === undefined) return null
  const parts = []
  if (x.pages !== undefined) parts.push(t.quotaPages(x.pages))
  parts.push(t.quotaNeeds(formatTokens(x.estimatedTokens)))
  if (x.bucketRemaining !== undefined) parts.push(t.quotaLeft(formatTokens(x.bucketRemaining)))
  return parts.join(t.dot)
}

export const FAILURES: Record<FailureKey, FailureCopy> = {
  network: { phase: 'admit', text: () => t.failNetwork, retry: true },
  pages: { phase: 'admit', text: (x) => t.failPages(x.pages === undefined ? '?' : String(x.pages), MAX_PAGES), act: 'split' },
  size: { phase: 'admit', text: () => t.failSize(MAX_MB) },
  missing: { phase: 'admit', text: () => t.failMissing },
  parse: { phase: 'admit', text: () => t.failParse },
  quota: {
    phase: 'admit',
    title: (x) => t.failQuotaTitle(tierName(x.tier)),
    text: () => t.failQuota,
    detail: quotaDetail,
    act: 'upgrade',
  },
  quotaEmpty: {
    phase: 'admit',
    title: (x) => t.failQuotaEmptyTitle(tierName(x.tier)),
    text: () => t.failQuotaEmpty,
    detail: quotaDetail,
    act: 'upgrade',
  },
  noAccess: { phase: 'admit', title: () => t.failNoAccessTitle, text: () => t.failNoAccess, act: 'subscribe' },
  model: { phase: 'admit', title: () => t.failModelTitle, text: (x) => t.failModel(x.modelName ?? t.selectedModel), act: 'model' },
  scan: { phase: 'run', text: () => t.failScan, act: 'help' },
  undecodable: { phase: 'run', text: () => t.failUndecodable },
  already: { phase: 'run', text: () => t.failAlready },
  auth: { phase: 'run', text: () => t.failAuth, act: 'relogin' },
  unavailable: { phase: 'run', text: () => t.failUnavailable, retry: true },
  internal: { phase: 'run', text: () => t.failInternal, retry: true, act: 'feedback' },
}

export function failureTitle(f: Failure): string {
  const copy = FAILURES[f.key]
  return copy.title?.(f.facts) ?? (copy.phase === 'admit' ? t.cannotStart : t.failed)
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** A refusal from `POST /uploads/intent`, `/uploads/complete` or `/tasks`. */
export function admitFailure(error: ApiError, facts: FailureFacts = {}): Failure {
  const reason = typeof error.details.reason === 'string' ? error.details.reason : undefined
  if (error.isNetwork || error.status >= 500 || error.status === 429) return { key: 'network', facts }
  if (error.status === 401) return { key: 'auth', facts }
  if (error.code === 'PAGE_LIMIT_EXCEEDED') {
    return { key: 'pages', facts: { ...facts, pages: num(error.details.pageCount) ?? facts.pages } }
  }
  if (error.code === 'PDF_PARSE_ERROR') return { key: 'parse', facts }
  if (error.code === 'FILE_TOO_LARGE' || error.status === 413) return { key: 'size', facts }
  if (error.status === 403 && reason === 'MODEL_NOT_IN_PLAN') return { key: 'model', facts }
  if (error.status === 402 && reason === 'QUOTA_EXCEEDED') {
    const remaining = num(error.details.bucketRemaining)
    return {
      key: remaining !== undefined && remaining <= 0 ? 'quotaEmpty' : 'quota',
      facts: { ...facts, estimatedTokens: num(error.details.estimatedTokens), bucketRemaining: remaining },
    }
  }
  if (error.status === 402) return { key: 'noAccess', facts }
  return { key: 'network', facts }
}

/** A task that ended FAILED, by its `errorCode`. */
export function runFailure(errorCode: string | null | undefined): Failure {
  switch (errorCode) {
    case 'NO_TRANSLATABLE_TEXT':
    case 'SCANNED_PDF':
      return { key: 'scan', facts: {} }
    case 'UNDECODABLE_CHARS':
      return { key: 'undecodable', facts: {} }
    case 'ALREADY_TRANSLATED':
      return { key: 'already', facts: {} }
    case 'AUTH_FAILED':
      return { key: 'auth', facts: {} }
    case 'SERVICE_UNAVAILABLE':
      return { key: 'unavailable', facts: {} }
    default:
      return { key: 'internal', facts: {} }
  }
}
