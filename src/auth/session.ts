// The signed-in session: tokens in Zotero's login store (encrypted with the OS key store when
// Zotero has one), access-token refresh, and authenticated API calls.
//
// Refresh tokens rotate on every use and the backend revokes the whole session when an old one is
// replayed, so refreshes are serialized through one promise.
import { ApiError, callApi, type CallOptions } from '../api/http.ts'
import { apiConfig, log } from '../env.ts'

export interface Tokens {
  accessToken: string
  refreshToken: string
  /** ISO time */
  accessTokenExpiresAt?: string
  refreshTokenExpiresAt?: string
}

interface AuthResponse extends Tokens {
  user?: { id?: string; email?: string | null; name?: string | null }
}

export class LoginRequired extends Error {
  constructor() {
    super('login required')
    this.name = 'LoginRequired'
  }
}

const LOGIN_ORIGIN = 'chrome://cocotranslate'
const LOGIN_REALM = 'CocoTranslate session'
const LOGIN_USER = 'tokens'

let tokens: Tokens | null = null
let refreshing: Promise<Tokens | null> | null = null
const listeners = new Set<(signedIn: boolean) => void>()

export function onSessionChange(fn: (signedIn: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isSignedIn(): boolean {
  return tokens !== null
}

function storedLogin(): NsILoginInfo | null {
  try {
    return Services.logins.findLogins(LOGIN_ORIGIN, null, LOGIN_REALM)[0] ?? null
  } catch (e) {
    Zotero.logError(e)
    return null
  }
}

export async function loadSession(): Promise<void> {
  const login = storedLogin()
  if (!login) return
  try {
    const keyStore = Zotero.OSKeyStore
    const raw = keyStore?.isEncrypted(login.password) ? await keyStore.decrypt(login.password) : login.password
    tokens = JSON.parse(raw) as Tokens
  } catch (e) {
    Zotero.logError(e)
    tokens = null
  }
}

async function persist(next: Tokens | null): Promise<void> {
  const old = storedLogin()
  if (!next) {
    if (old) Services.logins.removeLogin(old)
    return
  }
  const json = JSON.stringify(next)
  let stored = json
  if (Zotero.OSKeyStore) {
    try {
      stored = await Zotero.OSKeyStore.encrypt(json)
    } catch (e) {
      Zotero.logError(e)
    }
  }
  const LoginInfo = Components.Constructor('@mozilla.org/login-manager/loginInfo;1', Components.interfaces.nsILoginInfo, 'init')
  const info = new LoginInfo(LOGIN_ORIGIN, null, LOGIN_REALM, LOGIN_USER, stored, '', '')
  if (old) Services.logins.modifyLogin(old, info)
  else await Services.logins.addLoginAsync(info)
}

async function setTokens(next: Tokens | null): Promise<void> {
  const changed = (tokens === null) !== (next === null)
  tokens = next
  await persist(next)
  if (changed) for (const fn of listeners) fn(next !== null)
}

export async function signIn(auth: AuthResponse): Promise<void> {
  await setTokens({
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accessTokenExpiresAt: auth.accessTokenExpiresAt,
    refreshTokenExpiresAt: auth.refreshTokenExpiresAt,
  })
}

export async function signOut(): Promise<void> {
  const current = tokens
  await setTokens(null)
  if (current) {
    callApi(apiConfig(), '/api/v1/auth/logout', { method: 'POST', body: {}, token: current.accessToken }).catch(() => {})
  }
}

function expiresSoon(iso: string | undefined, marginMs: number): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t - Date.now() < marginMs
}

async function refresh(): Promise<Tokens | null> {
  if (refreshing) return refreshing
  const used = tokens
  if (!used) return null
  refreshing = (async () => {
    try {
      const next = await callApi<AuthResponse>(apiConfig(), '/api/v1/auth/token/refresh', {
        body: { refreshToken: used.refreshToken },
      })
      // A sign-out or another sign-in while this was in flight wins.
      if (tokens !== used) return tokens
      await signIn(next)
      log('access token refreshed')
      return tokens
    } catch (e) {
      // 4xx: the refresh token is expired, revoked or reused, so the session is gone.
      // 5xx and network errors say nothing about the token; keep it and let the caller retry.
      if (e instanceof ApiError && !e.isNetwork && e.status < 500) {
        log(`refresh rejected (${e.status} ${e.code}); signed out`)
        if (tokens === used) await setTokens(null)
        return null
      }
      throw e
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function accessToken(): Promise<string> {
  let current = tokens
  if (!current) throw new LoginRequired()
  if (expiresSoon(current.accessTokenExpiresAt, 60_000)) current = await refresh()
  if (!current) throw new LoginRequired()
  return current.accessToken
}

/** An API call as the signed-in user; refreshes once on 401. Throws LoginRequired when there is no session. */
export async function authedCall<T>(path: string, options: Omit<CallOptions, 'token'> = {}): Promise<T> {
  const token = await accessToken()
  try {
    return await callApi<T>(apiConfig(), path, { ...options, token })
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e
    const next = tokens?.accessToken === token ? await refresh() : tokens
    if (!next) throw new LoginRequired()
    return callApi<T>(apiConfig(), path, { ...options, token: next.accessToken })
  }
}
