import type { ProviderAccess } from '../credentials.ts'
import { getJsonOptional, type FetchLike } from '../http.ts'
import type { ProviderIdentity, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedFraction, resetLabel, isoInstant, toNumber } from '../remaining.ts'
import type { ProviderAdapter, UsageFields } from './types.ts'

export const identity: ProviderIdentity = {
  id: 'commandcode',
  name: 'Command Code',
  accent: '#111111',
  usageUrl: 'https://commandcode.ai/usage',
  statusUrl: 'https://commandcode.ai/usage',
}

const ACCOUNT_API = 'https://api.commandcode.ai'

const PLAN_POOL: Record<string, number> = {
  'individual-go': 10,
  'individual-goat': 70,
  'individual-pro-v1': 80,
  'individual-pro': 30,
  'individual-provider': 15,
  'individual-max': 150,
  'individual-ultra': 300,
  'teams-pro': 40,
}

const PLAN_NAMES: Record<string, string> = {
  'individual-go': 'Go',
  'individual-goat': 'GOAT',
  'individual-pro-v1': 'Pro',
  'individual-pro': 'Pro',
  'individual-provider': 'Provider',
  'individual-max': 'Max',
  'individual-ultra': 'Ultra',
  'teams-pro': 'Teams Pro',
}

function unwrap(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  let current = value
  for (let i = 0; i < 3; i += 1) {
    if (!isRecord(current['data'])) break
    current = current['data']
  }
  return current
}

function nested(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return isRecord(value[key]) ? value[key] : undefined
}

function nonNeg(value: unknown): number | undefined {
  const n = toNumber(value)
  return n !== undefined && n >= 0 ? n : undefined
}

function planKey(planId: string | undefined): string | undefined {
  if (planId === undefined) return undefined
  const id = planId.toLowerCase()
  return Object.keys(PLAN_POOL).sort((a, b) => b.length - a.length).find(key => id.startsWith(key))
}

function parsePacing(
  value: unknown,
  id: string,
  label: string,
  now: number,
): QuotaWindow | undefined {
  if (!isRecord(value)) return undefined
  const used = nonNeg(value['used'] ?? value['usage'] ?? value['consumed'])
  const cap = nonNeg(value['cap'] ?? value['limit'] ?? value['total'])
  if (used === undefined || cap === undefined || cap <= 0) return undefined
  const resetsAt = isoInstant(value['resetAt'] ?? value['reset_at'] ?? value['resetsAt'] ?? value['resets_at'] ?? value['reset'])
  return {
    id,
    label,
    remaining: remainingFromUsedFraction(used / cap),
    ...resetsAt === undefined ? {} : { resetsAt },
    resetLabel: resetLabel(resetsAt, now),
    primary: false,
  }
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`
}

function parseCommandCodeUsage(
  creditsBody: unknown,
  subscriptionBody: unknown,
  summaryBody: unknown,
  now: number,
): UsageFields {
  const creditsRoot = unwrap(creditsBody) ?? {}
  const credits = nested(creditsRoot, 'credits') ?? creditsRoot
  const windowsRoot = nested(creditsRoot, 'windowLimits') ?? nested(credits, 'windowLimits')
  const monthlyCredits = nonNeg(credits['monthlyCredits'])
  const purchasedCredits = nonNeg(credits['purchasedCredits'])
  const freeCredits = nonNeg(credits['freeCredits'])
  const sub = unwrap(subscriptionBody) ?? {}
  const planId = typeof sub['planId'] === 'string' ? sub['planId']
    : typeof credits['planId'] === 'string' ? credits['planId']
    : undefined
  const key = planKey(planId)
  const summary = unwrap(summaryBody) ?? {}
  const spent = nonNeg(summary['totalMonthlyCredits']) ?? nonNeg(summary['total_cost']) ?? nonNeg(summary['totalCost'])
  const tablePool = key === undefined ? undefined : PLAN_POOL[key]
  const cap = tablePool ?? (monthlyCredits !== undefined && spent !== undefined ? monthlyCredits + spent : undefined)
  const monthlyRemaining = monthlyCredits !== undefined && cap !== undefined && cap > 0
    ? Math.min(1, Math.max(0, monthlyCredits / cap))
    : null
  const periodEnd = isoInstant(sub['currentPeriodEnd'] ?? sub['current_period_end'])
  const windows: QuotaWindow[] = []
  if (monthlyCredits !== undefined || monthlyRemaining !== null) {
    windows.push({
      id: 'monthly',
      label: 'Monthly',
      remaining: monthlyRemaining,
      ...periodEnd === undefined ? {} : { resetsAt: periodEnd },
      resetLabel: resetLabel(periodEnd, now),
      primary: true,
    })
  }
  const session = parsePacing(windowsRoot?.['fiveHour'] ?? windowsRoot?.['five_hour'], 'session', '5-hour', now)
  const weekly = parsePacing(windowsRoot?.['weekly'], 'weekly', 'Weekly', now)
  if (session !== undefined) windows.push(session)
  if (weekly !== undefined) windows.push(weekly)
  if (windows.length === 0 && monthlyCredits === undefined && purchasedCredits === undefined && freeCredits === undefined)
    throw new Error('Command Code usage reply listed no quota')
  if (windows.length > 0 && !windows.some(window => window.primary)) windows[0]!.primary = true
  const extras: string[] = []
  if (purchasedCredits !== undefined && purchasedCredits > 0)
    extras.push(`${dollars(purchasedCredits)} purchased`)
  if (freeCredits !== undefined && freeCredits > 0)
    extras.push(`${dollars(freeCredits)} free`)
  const primary = windows.find(window => window.primary)
  return {
    ...key === undefined ? {} : { plan: PLAN_NAMES[key] ?? planId },
    remaining: primary?.remaining ?? null,
    windows,
    ...monthlyCredits === undefined ? {} : { cost: { month: `${dollars(monthlyCredits)} remaining` } },
    ...extras.length === 0 ? {} : { extraNote: extras.join(' · ') },
  }
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'user-agent': 'pub-engine',
  }
}

function query(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value)
  }
  const encoded = search.toString()
  return encoded.length === 0 ? path : `${path}?${encoded}`
}

function orgId(body: unknown): string | undefined {
  const root = unwrap(body)
  const org = root === undefined ? undefined : nested(root, 'org')
  const id = org?.['id']
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function periodStart(body: unknown): string | undefined {
  const root = unwrap(body)
  return isoInstant(root?.['currentPeriodStart'] ?? root?.['current_period_start'])
}

async function pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields> {
  const auth = headers(access.token)
  const whoami = await getJsonOptional(fetchImpl, `${ACCOUNT_API}/alpha/whoami`, auth)
  const id = orgId(whoami)
  const [credits, subscription] = await Promise.all([
    getJsonOptional(fetchImpl, `${ACCOUNT_API}${query('/alpha/billing/credits', { orgId: id })}`, auth),
    getJsonOptional(fetchImpl, `${ACCOUNT_API}${query('/alpha/billing/subscriptions', { orgId: id })}`, auth),
  ])
  const since = periodStart(subscription)
  const summary = await getJsonOptional(
    fetchImpl,
    `${ACCOUNT_API}${query('/alpha/usage/summary', { orgId: id, since })}`,
    auth,
  )
  return parseCommandCodeUsage(credits, subscription, summary, now)
}

export const commandCode: ProviderAdapter = { identity, pull }
