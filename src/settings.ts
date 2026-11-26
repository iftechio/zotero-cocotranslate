// Target language and model. The model list, its default and which plan unlocks each model come
// from the backend's public plans list, as on the web site, not from this code.
import { getPlans, type Plans, type QuotaTier } from './api/account.ts'
import { hasGeneralBalance, planKey } from './account.ts'
import { log, pref, webLocale } from './env.ts'

export const LANG_NAMES: Record<string, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  'zh-TW': '繁體中文（台灣）',
  'zh-HK': '繁體中文（香港）',
  ja: '日本語',
  ko: '한국어',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ru: 'Русский',
  pt: 'Português',
  'pt-BR': 'Português (Brasil)',
  it: 'Italiano',
}

const FALLBACK_MODEL = 'gpt-6-luna'
let plans: Plans | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

export function onPlansChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function loadPlans(): Promise<void> {
  loading ??= getPlans()
    .then((p) => {
      plans = p
      for (const fn of listeners) fn()
    })
    .catch((e: unknown) => log(`plans unavailable: ${String(e)}`))
    .finally(() => {
      loading = null
    })
  return loading
}

export function plansLoaded(): boolean {
  return plans !== null
}

/** Until chosen, the language of Zotero's interface, as on the web site. */
export function targetLang(): string {
  const l = webLocale()
  return pref('targetLang', l === 'zh-TW' || l === 'zh-HK' ? 'zh-TW' : l === 'en' || l === 'ja' || l === 'ko' ? l : 'zh-CN')
}

export function defaultModel(): string {
  return plans?.defaultModelId || FALLBACK_MODEL
}

export function model(): string {
  return pref('model', '') || defaultModel()
}

export function modelName(id: string): string {
  return plans?.showcaseModels?.find((m) => m.modelId === id)?.displayName ?? id
}

export function modelTier(id: string): QuotaTier | undefined {
  return plans?.showcaseModels?.find((m) => m.modelId === id)?.quotaTier
}

export interface ModelChoice {
  id: string
  name: string
  isDefault: boolean
  /** the user's plan does not cover it */
  locked: boolean
  /** the cheapest plan that does */
  needs: 'Pro' | 'Max' | null
  maintenance: boolean
}

/** The showcase models with what the current account may use, as the web's model picker shows them. */
export function modelChoices(): ModelChoice[] {
  if (!plans) return []
  const key = planKey()
  const tiers = new Set<QuotaTier>(
    plans.skus.find((s) => s.planKey === key)?.accessibleTiers ??
      (key === 'max' ? ['ADVANCED', 'TOP'] : key === 'pro' ? ['ADVANCED'] : []),
  )
  const anyModel = hasGeneralBalance()
  return plans.showcaseModels.map((m) => {
    const open = anyModel || m.freeGrant === true
    return {
      id: m.modelId,
      name: m.displayName,
      isDefault: m.modelId === defaultModel(),
      locked: !open && !tiers.has(m.quotaTier),
      needs: open ? null : m.quotaTier === 'TOP' ? 'Max' : 'Pro',
      maintenance: m.availability === 'maintenance',
    }
  })
}
