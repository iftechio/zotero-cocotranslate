// Unit tests for the parts that do not need Zotero. Node runs the TypeScript sources directly.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { ApiError } from '../src/api/http.ts'
import { base64url, challengeFor, randomToken } from '../src/auth/pkce.ts'
import { admitFailure, failureTitle, FAILURES, formatTokens, runFailure } from '../src/translate/errors.ts'
import { filenameFromDisposition, filenameFromSignedURL, resultFilename, safeFilename } from '../src/translate/filename.ts'
import { formatWait, queueText } from '../src/translate/format.ts'

test('PKCE verifier and S256 challenge match RFC 7636', async () => {
  const verifier = randomToken(32)
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
  const expected = createHash('sha256').update(verifier).digest('base64url')
  assert.equal(await challengeFor(verifier), expected)
  // RFC 7636 appendix B
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  assert.equal(base64url(new Uint8Array([251, 255])), '-_8')
})

test('refusals map to the design copy', () => {
  const quota = admitFailure(new ApiError(402, 'QUOTA_EXCEEDED', 'x', { reason: 'QUOTA_EXCEEDED', estimatedTokens: 144000, bucketRemaining: 30000 }))
  assert.equal(quota.key, 'quota')
  assert.equal(failureTitle(quota), '高级模型本期剩余额度不足')
  assert.equal(FAILURES.quota.detail(quota.facts), '约需 14.4万 token · 剩 3万')

  assert.equal(admitFailure(new ApiError(402, 'QUOTA_EXCEEDED', 'x', { reason: 'QUOTA_EXCEEDED', bucketRemaining: 0 })).key, 'quotaEmpty')
  assert.equal(admitFailure(new ApiError(402, 'QUOTA_EXCEEDED', 'x', { reason: 'NO_ACCESS' })).key, 'noAccess')
  assert.equal(admitFailure(new ApiError(403, 'FORBIDDEN', 'x', { reason: 'MODEL_NOT_IN_PLAN' })).key, 'model')
  assert.equal(admitFailure(new ApiError(422, 'PAGE_LIMIT_EXCEEDED', 'x', { pageCount: 312 })).facts.pages, 312)
  assert.equal(admitFailure(new ApiError(422, 'PDF_PARSE_ERROR', 'x')).key, 'parse')
  assert.equal(admitFailure(new ApiError(413, 'FILE_TOO_LARGE', 'x')).key, 'size')
  assert.equal(admitFailure(new ApiError(0, 'NETWORK_ERROR', 'x')).key, 'network')
  assert.equal(admitFailure(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x')).key, 'network')
  assert.equal(failureTitle(admitFailure(new ApiError(503, 'X', 'x'))), '无法开始翻译')
})

test('failed tasks map by errorCode', () => {
  assert.equal(runFailure('SCANNED_PDF').key, 'scan')
  assert.equal(runFailure('NO_TRANSLATABLE_TEXT').key, 'scan')
  assert.equal(runFailure('UNDECODABLE_CHARS').key, 'undecodable')
  assert.equal(runFailure('ALREADY_TRANSLATED').key, 'already')
  assert.equal(runFailure('AUTH_FAILED').key, 'auth')
  assert.equal(runFailure('LEASE_EXPIRED').key, 'internal')
  assert.equal(runFailure(null).key, 'internal')
  assert.equal(failureTitle(runFailure('SCANNED_PDF')), '翻译失败')
  assert.equal(FAILURES.scan.retry, undefined)
  assert.equal(FAILURES.internal.retry, true)
})

test('result file names follow the backend', () => {
  assert.equal(resultFilename('Attention Is All You Need.pdf', 'dual'), 'Attention Is All You Need-dual.pdf')
  assert.equal(resultFilename('paper.PDF', 'mono'), 'paper-mono.pdf')
  assert.equal(resultFilename('.pdf', 'mono'), 'mono.pdf')
  assert.equal(filenameFromDisposition(`attachment; filename="a.pdf"; filename*=UTF-8''%E8%AE%BA%E6%96%87-dual.pdf`), '论文-dual.pdf')
  assert.equal(filenameFromDisposition('attachment; filename="plain-mono.pdf"'), 'plain-mono.pdf')
  assert.equal(filenameFromDisposition(null), null)
  const signed = `https://bucket.oss.example.com/x.pdf?Expires=1&response-content-disposition=${encodeURIComponent(`attachment; filename*=UTF-8''${encodeURIComponent('论文-dual.pdf')}`)}`
  assert.equal(filenameFromSignedURL(signed), '论文-dual.pdf')
  assert.equal(filenameFromSignedURL('https://example.com/x.pdf'), null)
  assert.equal(safeFilename('../../etc/passwd'), '.._.._etc_passwd')
})

test('queue and progress wording matches the web', () => {
  assert.equal(formatWait(45), '45 秒')
  assert.equal(formatWait(61), '2 分钟')
  assert.equal(formatWait(3600), '1 小时')
  assert.equal(formatWait(3900), '1 小时 5 分钟')
  assert.equal(queueText(3, 200, false), '排队中，前方还有 3 个任务 · 预计等待 4 分钟')
  assert.equal(queueText(3, 0, true), '会员优先排队中，前方还有 3 个任务')
  assert.equal(queueText(0, 100, false), '等待处理…')
  assert.equal(formatTokens(20000000), '2000万')
})
