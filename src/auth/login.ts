// Browser login: open {site}/auth/authorize in the system browser; the web signs the user in and
// sends a one-time code back to an endpoint on Zotero's local HTTP server, which the plugin swaps
// for tokens.
//
// - `state` is also baked into redirect_uri, because older versions of the authorize page do not
//   pass a separate `state` parameter through but do keep redirect_uri's own query.
// - PKCE S256 (RFC 7636) protects the one-time code on its way back.
// - The endpoint has to accept requests from browsers (the redirect is a top-level navigation), so
//   any web page could also call it. Callbacks without the state of the login in progress are
//   refused, which keeps a page from signing Zotero into someone else's account.
import { callApi } from '../api/http.ts'
import { apiConfig, log, siteURL, webLocale } from '../env.ts'
import { t } from '../i18n/index.ts'
import { challengeFor, randomToken } from './pkce.ts'
import { signIn, type Tokens } from './session.ts'

export const CALLBACK_PATH = '/coco/auth'

interface PendingLogin {
  state: string
  verifier: string
  url: string
  promise: Promise<void>
  resolve: () => void
  reject: (e: Error) => void
}

let pending: PendingLogin | null = null
const listeners = new Set<() => void>()

/** Called when a browser login starts or ends, so the popup can say it is waiting for the browser. */
export function onLoginStateChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setPending(next: PendingLogin | null): void {
  pending = next
  for (const fn of listeners) fn()
}

function callbackURL(state: string): string {
  const port = Number(Zotero.Prefs.get('httpServer.port')) || 23119
  return `http://127.0.0.1:${port}${CALLBACK_PATH}?state=${state}`
}

/** Opens the browser login (again, if one is already waiting) and resolves once signed in. */
export async function startLogin(): Promise<void> {
  if (!pending) {
    const state = randomToken(16)
    const verifier = randomToken(32)
    const challenge = await challengeFor(verifier)
    const query = new URLSearchParams({
      redirect_uri: callbackURL(state),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    let resolve!: () => void
    let reject!: (e: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    setPending({ state, verifier, url: `${siteURL()}/${webLocale()}/auth/authorize?${query}`, promise, resolve, reject })
  }
  const login = pending!
  log('opening browser login')
  // Development runs on a machine without a browser (scripts/start.mjs on Linux) need the URL to open elsewhere.
  if (__DEV__) log(`login URL: ${login.url}`)
  Zotero.launchURL(login.url)
  return login.promise
}

export function cancelLogin(): void {
  pending?.reject(new Error('login cancelled'))
  if (pending) setPending(null)
}

export function isLoginPending(): boolean {
  return pending !== null
}

type CallbackResult = { ok: true } | { ok: false; reason: 'unexpected' | 'denied' | 'failed' }

async function handleCallback(params: URLSearchParams): Promise<CallbackResult> {
  const login = pending
  if (!login || params.get('state') !== login.state) return { ok: false, reason: 'unexpected' }
  if (params.get('error')) {
    setPending(null)
    login.reject(new Error(`login ${params.get('error')}`))
    return { ok: false, reason: 'denied' }
  }
  const code = params.get('auth_code')
  if (!code) return { ok: false, reason: 'failed' }
  try {
    const auth = await callApi<Tokens>(apiConfig(), '/api/v1/auth/code/exchange', {
      body: { code, codeVerifier: login.verifier },
    })
    await signIn(auth)
  } catch (e) {
    Zotero.logError(e)
    return { ok: false, reason: 'failed' }
  }
  setPending(null)
  login.resolve()
  log('signed in')
  return { ok: true }
}

function page(result: CallbackResult): string {
  const [title, text] = result.ok
    ? [t.backOkTitle, t.backOk]
    : result.reason === 'denied'
      ? [t.backDeniedTitle, t.backDenied]
      : [result.reason === 'unexpected' ? t.backExpiredTitle : t.backFailedTitle, t.backAgain]
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html lang="${t.intl}"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1d1d1f;background:#f6f6f4}
main{text-align:center;padding:24px}h1{font-size:20px;margin:0 0 6px}p{margin:0;color:#555}
@media (prefers-color-scheme:dark){body{background:#1c1c1e;color:#f2f2f2}p{color:#b8b8b8}}</style>
<main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></html>`
}

class AuthCallbackEndpoint {
  supportedMethods = ['GET']
  // The browser redirect is a top-level navigation from a web page; Zotero refuses those unless
  // the endpoint opts in. The state check above is what keeps this safe.
  // Zotero 9+: an explicit opt-in.
  allowRequestsFromUnsafeWebContent = true
  // Zotero 7 and 8 have no opt-in; they let a browser through when the endpoint only takes a
  // content type a web form cannot send. This one takes no body at all.
  supportedDataTypes = ['application/json']

  async init(request: ZoteroServerRequest): Promise<ZoteroServerResult> {
    const result = await handleCallback(request.searchParams)
    if (result.ok) {
      const win = Zotero.getMainWindow()
      if (win) Zotero.Utilities.Internal.activate(win)
    }
    return [result.ok ? 200 : 400, 'text/html; charset=utf-8', page(result)]
  }
}

export function registerCallbackEndpoint(): void {
  Zotero.Server.Endpoints[CALLBACK_PATH] = AuthCallbackEndpoint
}

export function unregisterCallbackEndpoint(): void {
  delete Zotero.Server.Endpoints[CALLBACK_PATH]
  cancelLogin()
}
