// What the signed-in user has: profile, plan, this period's usage and balance. Read by the settings
// pane, the model picker and the popup's wording; refreshed on sign-in and whenever the pane opens.
import {
  getBalance,
  getMySubscription,
  getProfile,
  getUsage,
  type Balance,
  type PlanKey,
  type Profile,
  type Subscription,
  type Usage,
} from './api/account.ts'
import { isSignedIn, LoginRequired, onSessionChange } from './auth/session.ts'
import { log } from './env.ts'

export interface Account {
  profile: Profile | null
  subscription: Subscription | null
  usage: Usage | null
  balance: Balance | null
  /** at least one lookup failed for a reason other than being signed out */
  failed: boolean
  loaded: boolean
}

const empty = (): Account => ({ profile: null, subscription: null, usage: null, balance: null, failed: false, loaded: false })

let account = empty()
let generation = 0
const listeners = new Set<() => void>()

export function currentAccount(): Readonly<Account> {
  return account
}

export function onAccountChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function changed(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      Zotero.logError(e)
    }
  }
}

export async function refreshAccount(): Promise<void> {
  const mine = ++generation
  if (!isSignedIn()) {
    account = empty()
    changed()
    return
  }
  const [profile, sub, usage, balance] = await Promise.allSettled([getProfile(), getMySubscription(), getUsage(), getBalance()])
  if (mine !== generation) return
  const value = <T,>(r: PromiseSettledResult<T>, old: T | null): T | null => (r.status === 'fulfilled' ? r.value : old)
  const failures = [profile, sub, usage, balance].filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  for (const f of failures) if (!(f.reason instanceof LoginRequired)) log(`account lookup failed: ${String(f.reason)}`)
  account = {
    profile: value(profile, account.profile),
    subscription: sub.status === 'fulfilled' ? sub.value.subscription : account.subscription,
    usage: value(usage, account.usage),
    balance: value(balance, account.balance),
    failed: failures.some((f) => !(f.reason instanceof LoginRequired)),
    loaded: true,
  }
  changed()
}

/** Clears the account on sign-out and loads it on sign-in. */
export function watchAccount(): () => void {
  const off = onSessionChange(() => void refreshAccount())
  if (isSignedIn()) void refreshAccount()
  return off
}

export function planKey(): PlanKey {
  const sub = account.subscription
  return sub?.isActive ? sub.planKey : 'free'
}

/** Pro / Max users get the cancel confirmation and the priority-queue wording. */
export function isSubscriber(): boolean {
  return planKey() !== 'free'
}

const amount = (a: { coco: string } | undefined) => Number.parseFloat(a?.coco ?? '') || 0

/** Money that pays for any model (top-ups, old grants): the web lifts the model locks for it. */
export function hasGeneralBalance(): boolean {
  const b = account.balance
  if (!b) return false
  if (amount(b.permanentBalance) > 0) return true
  return b.pools.some((p) => (p.scope == null || p.scope === 'general') && amount(p.availableAmount) > 0)
}
