import type { Locale } from './i18n/index.ts'
import type { ApiConfig } from './api/http.ts'

export const PREF = 'extensions.cocotranslate.'

export function pref<T>(name: string, fallback: T): T {
  const v = Zotero.Prefs.get(PREF + name, true)
  return v === undefined || v === null || v === '' ? fallback : (v as T)
}

export function setPref(name: string, value: unknown): void {
  Zotero.Prefs.set(PREF + name, value, true)
}

/** Calls `fn` when any of these prefs changes; returns the unsubscribe. */
export function onPrefChange(names: string[], fn: () => void): () => void {
  const ids = names.map((n) => Zotero.Prefs.registerObserver(PREF + n, fn, true))
  return () => ids.forEach((id) => Zotero.Prefs.unregisterObserver(id))
}

/** The web site and the API share one origin. `extensions.cocotranslate.siteURL` overrides it for development. */
export function siteURL(): string {
  return pref('siteURL', __SITE_URL__).replace(/\/+$/, '')
}

export function apiConfig(): ApiConfig {
  return { baseURL: siteURL(), appVersion: __VERSION__ }
}

/** The web's locale for Zotero's UI language; decides which login the web offers first (WeChat for zh-CN). */
export function webLocale(): Locale {
  const l = Zotero.locale || 'en-US'
  if (l === 'zh-CN') return 'zh-CN'
  if (l === 'zh-TW') return 'zh-TW'
  if (l === 'zh-HK') return 'zh-HK'
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('ko')) return 'ko'
  return 'en'
}

/** A page of the web site in the language of Zotero's UI. */
export function webURL(path: string): string {
  return `${siteURL()}/${webLocale()}${path}`
}

export function log(message: string): void {
  Zotero.debug(`[椰子翻译] ${message}`)
}
