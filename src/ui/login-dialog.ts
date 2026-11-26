// Signing in from the plugin. With Zotero in Simplified Chinese a small window shows WeChat's QR code
// (design: 登录椰子 / 扫码快速登录 / 其他登录方式 → Google); scanning signs in right there. Every other
// language, and 「使用 Google 账号登录」, uses the browser login (auth/login.ts), like the web, which
// also leads with WeChat only for zh-CN.
import { startLogin } from '../auth/login.ts'
import { onSessionChange } from '../auth/session.ts'
import { exchangeCode, getQrParams, interceptCallback, qrPageURL, STATE_LIFETIME_MS, type QrParams } from '../auth/wechat.ts'
import { log, webLocale } from '../env.ts'
import { t } from '../i18n/index.ts'
import { h } from './dom.ts'

const WINDOW_URL = 'chrome://cocotranslate/content/login.xhtml'

/** Signs in the way that suits Zotero's language; resolves once signed in. */
export function openLogin(): Promise<void> {
  return webLocale() === 'zh-CN' ? openWechatWindow() : startLogin()
}

let current: { win: Window; promise: Promise<void> } | null = null

function openWechatWindow(): Promise<void> {
  if (current && !current.win.closed) {
    current.win.focus()
    return current.promise
  }
  const parent = Zotero.getMainWindow()
  if (!parent) return startLogin()
  const win = (parent as unknown as { openDialog(url: string, name: string, features: string): Window }).openDialog(
    WINDOW_URL,
    'cocotranslate-login',
    'chrome,titlebar,close,centerscreen,resizable=no',
  )
  const promise = new Promise<void>((resolve, reject) => {
    win.addEventListener('load', () => mount(win, resolve, reject), { once: true })
  })
  current = { win, promise }
  // Nobody needs to hear that the window was closed; a translation waiting for login keeps waiting.
  promise.catch(() => {})
  return promise
}

// WeChat's page (its older template, which `href` styles) is drawn for a dark backdrop: white text
// and a dark pill around the hint. Restyle it to sit on the window, like the web's copy of it.
const QR_CSS = (dark: boolean) => {
  const text = dark ? '#ececec' : '#1d1d1f'
  const muted = dark ? '#a8abb0' : '#6b6f76'
  return `
  html, body { background: ${dark ? '#2b2b2e' : '#fff'} !important; color: ${text} !important; }
  body { padding-top: 0 !important; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
    "Noto Sans CJK SC", sans-serif !important; }
  .impowerBox .title { display: none; }
  .impowerBox .loginPanel, .impowerBox .waiting, .impowerBox .wrp_code { margin: 0 !important; padding: 0 !important; }
  .impowerBox .qrcode { width: 200px; margin-top: 0; border: 1px solid ${dark ? '#3e3e42' : '#e4e4e7'}; border-radius: 4px; }
  .impowerBox .info { width: auto; }
  .impowerBox .status, .impowerBox .status.normal { margin-top: 10px; padding: 0; background: none; box-shadow: none; text-align: center; }
  .impowerBox .status p { margin: 0; font-size: 13px; line-height: 1.6; color: ${text}; }
  .impowerBox .status_txt { text-align: left; }
  .impowerBox .status_txt h4 { margin: 0; font-size: 14px; color: ${text}; }
  .impowerBox .status_txt p { color: ${muted}; }
`
}

type View = { kind: 'loading' } | { kind: 'qr' } | { kind: 'signing' } | { kind: 'error'; text: string }

function mount(win: Window, resolve: () => void, reject: (e: Error) => void): void {
  const doc = win.document
  const root = doc.getElementById('cocotranslate-login')!
  doc.title = t.brand
  const dark = win.matchMedia('(prefers-color-scheme: dark)').matches
  let params: QrParams | null = null
  let stopIntercept: (() => void) | null = null
  let renewTimer: ReturnType<typeof setTimeout> | null = null
  let done = false

  const browser = (doc as unknown as { createXULElement(tag: string): XulBrowser }).createXULElement('browser')
  for (const [k, v] of Object.entries({
    type: 'content',
    remote: 'false',
    maychangeremoteness: 'true',
    disableglobalhistory: 'true',
    messagemanagergroup: 'cocotranslate-login',
    class: 'cl-browser',
  })) {
    browser.setAttribute(k, v)
  }
  const status = h(doc, 'div', { class: 'cl-status', role: 'status' })
  const box = h(doc, 'div', { class: 'cl-qr' }, browser, status)
  root.replaceChildren(
    h(doc, 'h1', {}, t.loginTitle),
    h(doc, 'p', { class: 'cl-sub' }, t.loginScan),
    box,
    h(doc, 'div', { class: 'cl-or' }, h(doc, 'span', {}, t.loginOther)),
    h(
      doc,
      'button',
      {
        class: 'cl-google',
        onclick: () => {
          void startLogin().catch(() => {})
          win.close()
        },
      },
      h(doc, 'img', { src: 'chrome://cocotranslate/content/icons/google.svg', alt: '' }),
      t.loginGoogle,
    ),
  )

  const show = (view: View) => {
    box.dataset.view = view.kind
    if (view.kind === 'qr') return status.replaceChildren()
    if (view.kind === 'error') {
      status.replaceChildren(
        h(doc, 'p', {}, view.text),
        h(doc, 'button', { class: 'cl-btn', onclick: () => void load() }, t.qrReload),
      )
      return
    }
    status.replaceChildren(h(doc, 'span', { class: 'cl-spin', 'aria-hidden': 'true' }), view.kind === 'loading' ? t.qrLoading : t.qrSigningIn)
  }

  // Load progress of WeChat's page: hide the placeholder once it is up, say so if it cannot load.
  const WPL = Components.interfaces.nsIWebProgressListener
  const progress = {
    QueryInterface: ChromeUtils.generateQI(['nsIWebProgressListener', 'nsISupportsWeakReference']),
    onStateChange(_wp: unknown, _req: unknown, flags: number, statusCode: number) {
      if (done || !(flags & WPL.STATE_STOP!) || !(flags & WPL.STATE_IS_WINDOW!)) return
      if (box.dataset.view !== 'loading') return
      // Our own cancel of the callback request also ends here; that one is not an error.
      if (statusCode !== 0 && statusCode !== Components.results.NS_BINDING_ABORTED) show({ kind: 'error', text: t.qrLoadFailed })
      else if (statusCode === 0) show({ kind: 'qr' })
    },
    onProgressChange() {},
    onLocationChange() {},
    onStatusChange() {},
    onSecurityChange() {},
    onContentBlockingEvent() {},
  }

  const onCode = async (code: string | null) => {
    if (!params || done) return
    if (!code) {
      show({ kind: 'error', text: t.qrCancelled })
      return
    }
    show({ kind: 'signing' })
    try {
      await exchangeCode(code, params.state)
      done = true
      log('signed in with WeChat')
      win.close()
    } catch (e) {
      log(`WeChat login failed: ${String(e)}`)
      show({ kind: 'error', text: t.qrFailed })
    }
  }

  async function load(): Promise<void> {
    stopIntercept?.()
    stopIntercept = null
    if (renewTimer) clearTimeout(renewTimer)
    show({ kind: 'loading' })
    try {
      params = await getQrParams()
    } catch (e) {
      log(`WeChat QR params: ${String(e)}`)
      show({ kind: 'error', text: t.qrOffline })
      return
    }
    if (win.closed) return
    const p = params
    stopIntercept = interceptCallback(p, (code) => void onCode(code))
    browser.loadURI(Services.io.newURI(qrPageURL(p, QR_CSS(dark))), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    })
    renewTimer = setTimeout(() => void load(), STATE_LIFETIME_MS)
  }

  // Signed in some other way meanwhile (the browser login): nothing left to do here.
  const offSession = onSessionChange((signedIn) => {
    if (!signedIn) return
    done = true
    win.close()
  })

  win.addEventListener(
    'unload',
    () => {
      stopIntercept?.()
      offSession()
      if (renewTimer) clearTimeout(renewTimer)
      try {
        browser.removeProgressListener(progress)
      } catch {}
      if (current?.win === win) current = null
      if (done) resolve()
      else reject(new Error('login window closed'))
    },
    { once: true },
  )
  win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') win.close()
  })

  browser.addProgressListener(progress, Components.interfaces.nsIWebProgress.NOTIFY_STATE_WINDOW!)
  void load()
}
