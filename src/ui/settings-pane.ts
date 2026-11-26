// The 椰子翻译 pane in Zotero's settings: account and this period's usage, the community, target
// language and model, and what happens to translations. Wording and rules follow the web site.
//
// addon/content/settings.xhtml is an empty shell whose load event calls mount(); everything inside
// is drawn here and redrawn when the session, the account or the plans list changes.
import type { UsageBucket } from '../api/account.ts'
import { currentAccount, onAccountChange, planKey, refreshAccount } from '../account.ts'
import { isLoginPending, onLoginStateChange } from '../auth/login.ts'
import { isSignedIn, onSessionChange, signOut } from '../auth/session.ts'
import { pref, setPref, siteURL, webLocale, webURL } from '../env.ts'
import { t } from '../i18n/index.ts'
import { LANG_NAMES, loadPlans, model, modelChoices, modelName, onPlansChange, plansLoaded, targetLang } from '../settings.ts'
import { formatTokens, tierName } from '../translate/errors.ts'
import { openWebPage } from '../web.ts'
import { h } from './dom.ts'
import { openLogin } from './login-dialog.ts'

const PANE_ID = 'cocotranslate-pane'
const DISCORD_INVITE_URL = 'https://discord.gg/Kg96MAqcdr'

export async function registerSettingsPane(): Promise<void> {
  await Zotero.PreferencePanes.register({
    pluginID: 'cocotranslate@cocotranslate.com',
    id: PANE_ID,
    src: 'content/settings.xhtml',
    label: t.brand,
    image: 'content/icons/coco-32.png',
    stylesheets: ['content/settings.css'],
  })
}

export function openSettings(): void {
  Zotero.Utilities.Internal.openPreferences(PANE_ID)
}

const mounted = new WeakMap<Element, () => void>()

export function mount(shell: Element): void {
  const root = shell.querySelector('#cocotranslate-settings')
  if (!root) return
  const draw = () => {
    if (!root.isConnected) return
    try {
      render(root)
    } catch (e) {
      Zotero.logError(e)
    }
  }
  const offs = [onSessionChange(draw), onAccountChange(draw), onPlansChange(draw), onLoginStateChange(draw)]
  mounted.set(shell, () => offs.forEach((off) => off()))
  draw()
  if (isSignedIn()) void refreshAccount()
  if (!plansLoaded()) void loadPlans()
}

export function unmount(shell: Element): void {
  mounted.get(shell)?.()
  mounted.delete(shell)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function icon(doc: Document, d: string, size = 12): Element {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  const path = doc.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.4')
  path.setAttribute('stroke-linejoin', 'round')
  path.setAttribute('stroke-linecap', 'round')
  svg.append(path)
  return svg
}

const CROWN = 'M2.5 5l3 2.5L8 3l2.5 4.5 3-2.5-1 7h-9z'
const EXTERNAL = 'M6 3H3v10h10v-3M9 3h4v4M13 3L7 9'

const dateText = (iso: string) => new Intl.DateTimeFormat(t.intl, { month: 'long', day: 'numeric' }).format(new Date(iso))
const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))

/** A link to a page of the site, opened signed in. */
function external(doc: Document, label: string, path: string): HTMLElement {
  return h(doc, 'button', { class: 'cc-link', onclick: () => void openWebPage(path) }, label, icon(doc, EXTERNAL, 11))
}

function render(root: Element): void {
  const doc = root.ownerDocument
  root.replaceChildren(
    h(doc, 'div', { class: 'cc-card' }, isSignedIn() ? signedIn(doc) : signedOut(doc), community(doc)),
    h(doc, 'div', { class: 'cc-card' }, languageRow(doc), modelRow(doc)),
    outputCard(doc),
    h(
      doc,
      'div',
      { class: 'cc-foot' },
      h(doc, 'span', {}, t.version(__VERSION__)),
      h(doc, 'button', { class: 'cc-quiet', onclick: () => Zotero.launchURL(webURL('/privacy')) }, t.privacy),
    ),
  )
}

/* ---------- account ---------- */

function signedIn(doc: Document): (HTMLElement | null)[] {
  const { profile, subscription } = currentAccount()
  const name = profile?.nickname || profile?.email || profile?.phone || ''
  const key = planKey()
  const avatar = profile?.avatar
    ? h(doc, 'img', { class: 'cc-av', src: profile.avatar, alt: '' })
    : h(doc, 'div', { class: 'cc-av', 'aria-hidden': 'true' }, (name || t.brand).slice(0, 1).toUpperCase())
  const idButton = profile ? accountID(doc, profile.id) : null
  return [
    h(
      doc,
      'div',
      { class: 'cc-acct' },
      avatar,
      h(
        doc,
        'div',
        { class: 'cc-who' },
        h(
          doc,
          'div',
          { class: 'cc-line' },
          h(doc, 'b', { class: 'cc-name', title: name }, name || '…'),
          h(doc, 'span', { class: `cc-pill ${key}` }, key === 'max' ? 'Max' : key === 'pro' ? 'Pro' : t.planFree),
          h(
            doc,
            'button',
            {
              class: 'cc-link',
              onclick: () => void openWebPage(subscription?.isActive ? '/subscription' : '/subscription/plans'),
            },
            icon(doc, CROWN, 14),
            subscription?.isActive ? t.memberCenter : t.upgradeMembership,
          ),
        ),
        idButton,
      ),
      h(doc, 'button', { class: 'cc-btn', onclick: () => void signOut() }, t.logOut),
    ),
    usage(doc),
  ]
}

function accountID(doc: Document, id: string): HTMLElement {
  const label = t.accountID(id.slice(0, 8))
  const btn = h(
    doc,
    'button',
    {
      class: 'cc-id',
      title: t.copyAccountID,
      onclick: () => {
        Zotero.Utilities.Internal.copyTextToClipboard(id)
        btn.textContent = t.accountIDCopied
        setTimeout(() => {
          btn.textContent = label
        }, 1500)
      },
    },
    label,
  )
  return btn
}

function meter(doc: Document, label: string, used: number, quota: number | null): HTMLElement {
  const share = quota ? Math.min(1, used / quota) : 0
  return h(
    doc,
    'div',
    { class: 'cc-bucket' },
    h(
      doc,
      'div',
      { class: 'cc-top' },
      h(doc, 'span', {}, label),
      h(doc, 'span', { class: 'cc-num' }, quota === null ? t.unlimited : t.usedOf(formatTokens(used), formatTokens(quota))),
    ),
    quota === null
      ? null
      : h(
          doc,
          'div',
          {
            class: `cc-meter${share > 0.9 ? ' low' : ''}`,
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(share * 100),
          },
          h(doc, 'i', { style: `width:${Math.max(share > 0 ? 1 : 0, share * 100)}%` }),
        ),
  )
}

function usage(doc: Document): HTMLElement | null {
  const { usage: u, subscription, failed, loaded } = currentAccount()
  if (!loaded) return null
  if (planKey() !== 'free' && u && u.buckets.length) {
    return h(
      doc,
      'div',
      { class: 'cc-usage' },
      h(
        doc,
        'div',
        { class: 'cc-top' },
        h(doc, 'b', {}, t.usageTitle),
        u.windowEnd ? h(doc, 'span', { class: 'cc-faint' }, t.resetsIn(daysUntil(u.windowEnd), dateText(u.windowEnd))) : null,
      ),
      subscription?.isFirstWeek ? h(doc, 'p', { class: 'cc-note' }, t.firstWeekNote) : null,
      u.buckets.map((b: UsageBucket) => meter(doc, tierName(b.tier), b.used, b.quota)),
      h(doc, 'div', { class: 'cc-more' }, external(doc, t.usageDetails, '/subscription')),
    )
  }
  if (failed && !u) return h(doc, 'div', { class: 'cc-usage cc-faint' }, t.usageUnavailable)
  return null
}

function signedOut(doc: Document): HTMLElement {
  const wechat = webLocale() === 'zh-CN'
  const waiting = isLoginPending()
  return h(
    doc,
    'div',
    { class: 'cc-acct cc-out' },
    h(
      doc,
      'div',
      { class: 'cc-ghost', 'aria-hidden': 'true' },
      h(doc, 'div', { class: 'cc-av' }),
      h(doc, 'div', { class: 'cc-who' }, h(doc, 'i', { style: 'width:170px' }), h(doc, 'i', { style: 'width:110px' })),
      h(doc, 'i', { class: 'cc-ghost-btn' }),
    ),
    h(
      doc,
      'button',
      { class: `cc-login${wechat ? '' : ' intl'}`, onclick: () => void openLogin().catch(() => {}) },
      h(doc, 'img', { src: `chrome://cocotranslate/content/icons/${wechat ? 'wechat' : 'google'}.svg`, alt: '' }),
      waiting ? t.loginWaiting : wechat ? t.loginWechatCTA : t.loginCTA,
    ),
  )
}

/* ---------- community ---------- */

function community(doc: Document): HTMLElement {
  return h(
    doc,
    'div',
    { class: 'cc-row' },
    h(doc, 'div', {}, h(doc, 'b', {}, t.communityTitle), h(doc, 'span', { class: 'cc-sub' }, t.communityDesc)),
    h(
      doc,
      'button',
      { class: 'cc-btn', onclick: () => (webLocale() === 'zh-CN' ? showQR(doc) : Zotero.launchURL(DISCORD_INVITE_URL)) },
      t.communityJoin,
      icon(doc, EXTERNAL, 11),
    ),
  )
}

/** The web site's WeChat group QR, so it changes with the site. */
function showQR(doc: Document): void {
  const close = () => {
    veil.remove()
    doc.removeEventListener('keydown', onKey, true)
  }
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }
  const closeBtn = h(doc, 'button', { class: 'cc-x', 'aria-label': t.close, onclick: close }, '×')
  const veil = h(
    doc,
    'div',
    { class: 'cc-veil', onclick: (e) => e.target === veil && close() },
    h(
      doc,
      'div',
      { class: 'cc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.communityTitle },
      closeBtn,
      h(doc, 'h3', {}, t.communityTitle),
      h(doc, 'p', { class: 'cc-sub' }, t.communityDesc),
      h(doc, 'img', { class: 'cc-qr', src: `${siteURL()}/community-qr.png`, alt: t.communityQrAlt, width: 184, height: 184 }),
      h(doc, 'p', { class: 'cc-faint' }, t.communityQrHint),
    ),
  )
  doc.addEventListener('keydown', onKey, true)
  ;(doc.getElementById('cocotranslate-settings') ?? doc.documentElement).append(veil)
  closeBtn.focus()
}

/* ---------- translation settings ---------- */

function select(
  doc: Document,
  label: string,
  value: string,
  options: { value: string; label: string; disabled?: boolean }[],
  onChange: (v: string) => void,
  disabled = false,
): HTMLElement {
  return h(
    doc,
    'select',
    { class: 'cc-sel', 'aria-label': label, disabled, onchange: (e) => onChange((e.target as HTMLSelectElement).value) },
    options.map((o) => h(doc, 'option', { value: o.value, selected: o.value === value, disabled: o.disabled }, o.label)),
  )
}

function languageRow(doc: Document): HTMLElement {
  return h(
    doc,
    'div',
    { class: 'cc-row big' },
    h(doc, 'b', {}, t.targetQuestion),
    select(
      doc,
      t.targetLang,
      targetLang(),
      Object.entries(LANG_NAMES).map(([value, label]) => ({ value, label })),
      (v) => setPref('targetLang', v),
    ),
  )
}

function modelRow(doc: Document): HTMLElement {
  const signedIn = isSignedIn()
  const current = model()
  const choices = modelChoices()
  const mine = choices.find((c) => c.id === current)
  const options = choices.length
    ? choices.map((c) => ({
        value: c.id,
        label: t.modelOption(c.name, c.isDefault, c.maintenance, c.locked ? c.needs : null),
        disabled: signedIn && c.locked,
      }))
    : [{ value: current, label: modelName(current) }]
  const note = !signedIn
    ? t.modelAfterLogin
    : mine?.locked
      ? t.modelNeedsPlan(mine.needs ?? 'Pro')
      : mine?.maintenance
        ? t.modelMaintenance
        : null
  return h(
    doc,
    'div',
    { class: 'cc-row big' },
    h(doc, 'div', {}, h(doc, 'b', {}, t.modelLabel), note ? h(doc, 'span', { class: `cc-sub${signedIn ? ' warn' : ''}` }, note) : null),
    select(doc, t.modelLabel, current, options, (v) => setPref('model', v), !signedIn || !choices.length),
  )
}

function toggle(doc: Document, label: string, name: string, fallback: boolean): HTMLElement {
  const on = pref(name, fallback)
  const sw = h(
    doc,
    'button',
    {
      class: 'cc-tog',
      role: 'switch',
      'aria-checked': String(on),
      'aria-label': label,
      onclick: () => {
        const next = sw.getAttribute('aria-checked') !== 'true'
        setPref(name, next)
        sw.setAttribute('aria-checked', String(next))
      },
    },
    h(doc, 'i'),
  )
  return h(doc, 'div', { class: 'cc-row flat' }, h(doc, 'b', {}, label), sw)
}

function outputCard(doc: Document): HTMLElement {
  return h(
    doc,
    'div',
    { class: 'cc-card' },
    h(doc, 'div', { class: 'cc-sec' }, t.outputsTitle),
    toggle(doc, t.autoOpen, 'autoOpen', false),
    toggle(doc, t.tagOutputs(t.outputTag), 'tagOutputs', true),
  )
}
