// WeChat QR login inside Zotero, the same flow as the web site's: the backend signs
// a state, WeChat's QR page is shown, and after the scan WeChat sends the page to the registered
// callback with ?code&state. The plugin stops that request before it reaches the web site and
// trades the code for a session itself (GET /wechat/callback), so nothing goes through a browser.
import { callApi } from '../api/http.ts'
import { apiConfig } from '../env.ts'
import { signIn, type Tokens } from './session.ts'

export interface QrParams {
  appid: string
  redirectUri: string
  state: string
  scope: string
}

/** The backend accepts the state for 10 minutes; ask for a new one a little before that. */
export const STATE_LIFETIME_MS = 9 * 60 * 1000

export const getQrParams = () => callApi<QrParams>(apiConfig(), '/api/v1/auth/wechat/qr-params', { timeoutMs: 15000 })

/** WeChat's embeddable QR page (what the web's WxLogin SDK puts in its iframe), redirecting itself. */
export function qrPageURL(p: QrParams, css: string): string {
  const q = new URLSearchParams({
    appid: p.appid,
    scope: p.scope,
    redirect_uri: p.redirectUri,
    state: p.state,
    login_type: 'jssdk',
    self_redirect: 'true',
    style: 'black',
    href: `data:text/css;base64,${btoa(css)}`,
  })
  return `https://open.weixin.qq.com/connect/qrconnect?${q}`
}

export async function exchangeCode(code: string, state: string): Promise<void> {
  const q = new URLSearchParams({ code, state })
  const auth = await callApi<Tokens | { requiresOtp: true }>(apiConfig(), `/api/v1/auth/wechat/callback?${q}`, { timeoutMs: 30000 })
  if ('requiresOtp' in auth) throw new Error('WeChat login asked for a one-time password')
  await signIn(auth)
}

/**
 * Watches for WeChat's redirect to `redirectUri` carrying our state and cancels it, so the code is
 * used once, here. `onResult` gets the code, or null when the user declined on the phone; it is
 * called at most once, then the watch ends.
 */
export function interceptCallback(p: QrParams, onResult: (code: string | null) => void): () => void {
  let active = true
  const stop = () => {
    if (!active) return
    active = false
    Services.obs.removeObserver(observer, 'http-on-modify-request')
  }
  const observer = {
    observe(subject: XpcomObject, topic: string): void {
      if (topic !== 'http-on-modify-request') return
      let channel: NsIHttpChannel
      try {
        channel = subject.QueryInterface<NsIHttpChannel>(Components.interfaces.nsIHttpChannel)
      } catch {
        return
      }
      const spec = channel.URI.spec
      if (!spec.startsWith(p.redirectUri)) return
      const url = new URL(spec)
      if (url.searchParams.get('state') !== p.state) return
      channel.cancel(Components.results.NS_BINDING_ABORTED!)
      stop()
      onResult(url.searchParams.get('code'))
    },
  }
  Services.obs.addObserver(observer, 'http-on-modify-request')
  return stop
}
