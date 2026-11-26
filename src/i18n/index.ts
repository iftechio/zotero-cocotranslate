// The plugin speaks the language of Zotero's interface, in the same six languages as the web
// site; anything else gets English. setLocale() runs at startup;
// Zotero restarts when its language changes.
import { en } from './en.ts'
import { ja } from './ja.ts'
import { ko } from './ko.ts'
import { zhCN, type Messages } from './zh-CN.ts'
import { zhHK } from './zh-HK.ts'
import { zhTW } from './zh-TW.ts'

export type Locale = 'zh-CN' | 'zh-TW' | 'zh-HK' | 'en' | 'ja' | 'ko'
export type { Messages }

const CATALOGS: Record<Locale, Messages> = { 'zh-CN': zhCN, 'zh-TW': zhTW, 'zh-HK': zhHK, en, ja, ko }

export let t: Messages = zhCN

export function setLocale(locale: Locale): void {
  t = CATALOGS[locale]
}

/** The output tag in every language, to recognise translations made under another one. */
export const OUTPUT_TAGS: ReadonlySet<string> = new Set(Object.values(CATALOGS).map((c) => c.outputTag))
