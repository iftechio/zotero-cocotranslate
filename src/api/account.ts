// Account API: profile, subscription, usage and balance, plus the public plans list.
import { authedCall } from '../auth/session.ts'
import { apiConfig } from '../env.ts'
import { callApi } from './http.ts'

export type PlanKey = 'free' | 'pro' | 'max'
export type QuotaTier = 'ADVANCED' | 'TOP'

export interface Profile {
  id: string
  email: string | null
  phone: string | null
  nickname: string | null
  avatar: string | null
}

export interface Subscription {
  planKey: 'pro' | 'max'
  status: string
  /** the only thing that decides whether the plan's benefits apply */
  isActive: boolean
  isFirstWeek: boolean
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
}

export interface MySubscription {
  subscription: Subscription | null
}

export interface UsageBucket {
  tier: QuotaTier
  /** null = unlimited */
  quota: number | null
  used: number
  remaining: number | null
}

export interface Usage {
  planKey: PlanKey
  windowStart: string | null
  windowEnd: string | null
  buckets: UsageBucket[]
}

interface Amount {
  coco: string
}

export interface Balance {
  permanentBalance: Amount
  pools: {
    /** general pays for any model; free_model is the new-user trial; older pools have none (= general) */
    scope?: 'general' | 'free_model' | 'asr'
    availableAmount: Amount
  }[]
}

export interface ShowcaseModel {
  modelId: string
  displayName: string
  quotaTier: QuotaTier
  /** the new-user trial can pay for it, so free users may use it */
  freeGrant?: boolean
  availability?: 'available' | 'maintenance'
}

export interface Plans {
  skus: { planKey: 'pro' | 'max'; accessibleTiers: QuotaTier[] }[]
  showcaseModels: ShowcaseModel[]
  defaultModelId?: string
}

export const getProfile = () => authedCall<Profile>('/api/v1/user/users/me')
export const getMySubscription = () => authedCall<MySubscription>('/api/v1/subscription/me')
export const getUsage = () => authedCall<Usage>('/api/v1/subscription/usage')
export const getBalance = () => authedCall<Balance>('/api/v1/user/balance')
export const getPlans = () => callApi<Plans>(apiConfig(), '/api/v1/subscription/plans')

/** A one-time code (60 s) that a web page on the site swaps for a session of the same user: `?auth_code=`. */
export const generateAuthCode = () =>
  authedCall<{ code: string; expiresIn: number }>('/api/v1/auth/code/generate', { body: {}, timeoutMs: 5000 })
