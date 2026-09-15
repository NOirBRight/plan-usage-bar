import type { ProviderAccess } from '../credentials.ts'
import { getJson, type FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedFraction, resetLabel, isoInstant, toNumber } from '../remaining.ts'
import type { ProviderAdapter, UsageFields } from './types.ts'

export const identity: ProviderIdentity = {
  id: 'ollama-cloud',
  name: 'Ollama Cloud',
  accent: '#111111',
  usageUrl: 'https://ollama.com',
  statusUrl: 'https://status.ollama.com',
}

const LIMIT_LABEL: Record<string, string> = {
  session: '5-hour',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

const FALLBACK_RESET: Record<string, string> = {
  session: 'Resets every 5h',
  weekly: 'Resets every 7d',
  monthly: 'Resets every 30d',
}

interface OllamaAccount {
  plan?: string
  createdAt?: string
  periodStart?: string
  periodEnd?: string
}

function parseOllamaUsage(
  body: unknown,
  now: number,
  account?: OllamaAccount,
): Pick<ProviderSnapshot, 'plan' | 'remaining' | 'windows' | 'cost' | 'note'> {
  if (!isRecord(body) || !isRecord(body['limits'])) {
    throw new Error('Ollama usage reply has no limits')
  }
  const limits = body['limits']
  const windows: QuotaWindow[] = []
  for (const [key, value] of Object.entries(limits)) {
    if (!isRecord(value)) continue
    const usage = value['usage']
    if (typeof usage !== 'number' || !Number.isFinite(usage) || usage < 0) continue
    const reset = windowReset(value, key, now, account)
    windows.push({
      id: key,
      label: LIMIT_LABEL[key] ?? titleCase(key),
      remaining: remainingFromUsedFraction(usage),
      ...reset,
      primary: key === 'weekly' || key === 'monthly',
    })
  }
  if (windows.length === 0) throw new Error('Ollama usage reply listed no quota windows')
  if (!windows.some(window => window.primary)) windows[0]!.primary = true
  const primary = windows.find(window => window.primary) ?? windows[0]!
  const activity = isRecord(body['activity']) ? body['activity'] : undefined
  const costValue = activity !== undefined && typeof activity['cost'] === 'string' ? activity['cost'] : undefined
  return {
    ...account?.plan === undefined ? {} : { plan: account.plan },
    remaining: primary.remaining,
    windows,
    ...costValue === undefined ? {} : { cost: { month: `$${trimCost(costValue)} · last 4 weeks` } },
  }
}

function windowReset(
  record: Record<string, unknown>,
  id: string,
  now: number,
  account?: OllamaAccount,
): Pick<QuotaWindow, 'resetsAt' | 'resetLabel'> {
  const direct = isoInstant(
    record['resets_at'] ?? record['reset_at'] ?? record['reset'] ?? record['resetsAt'],
  )
  const after = toNumber(record['reset_after_seconds'] ?? record['resetAfterSeconds'])
  const fromWire = direct ?? (after !== undefined && after >= 0
    ? new Date(now + after * 1000).toISOString()
    : undefined)
  const resetsAt = fromWire ?? (id === 'monthly' ? monthlyResetFromAccount(account, now) : undefined)
  if (resetsAt !== undefined)
    return { resetsAt, resetLabel: resetLabel(resetsAt, now) }
  return { resetLabel: FALLBACK_RESET[id] ?? '' }
}

/** Paid: SubscriptionPeriodEnd if still in the future; else next anniversary of period start or signup. */
function monthlyResetFromAccount(account: OllamaAccount | undefined, now: number): string | undefined {
  if (account === undefined) return undefined
  const periodEnd = isoInstant(account.periodEnd)
  if (periodEnd !== undefined && Date.parse(periodEnd) > now) return periodEnd
  return nextMonthlyAnniversary(account.periodStart ?? account.periodEnd ?? account.createdAt, now)
}
function nextMonthlyAnniversary(createdAt: string | undefined, now: number): string | undefined {
  if (createdAt === undefined) return undefined
  const origin = Date.parse(createdAt)
  if (!Number.isFinite(origin)) return undefined
  const start = new Date(origin)
  const day = start.getUTCDate()
  const hour = start.getUTCHours()
  const minute = start.getUTCMinutes()
  const second = start.getUTCSeconds()
  const ms = start.getUTCMilliseconds()
  const current = new Date(now)
  let year = current.getUTCFullYear()
  let month = current.getUTCMonth()
  let stamp = utcClamped(year, month, day, hour, minute, second, ms)
  if (stamp <= now) {
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
    stamp = utcClamped(year, month, day, hour, minute, second, ms)
  }
  return new Date(stamp).toISOString()
}

function utcClamped(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): number {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Date.UTC(year, month, Math.min(day, last), hour, minute, second, ms)
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
}

function titleCase(value: string): string {
  if (value.length === 0) return value
  return value[0]!.toUpperCase() + value.slice(1)
}

function trimCost(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return value
  return n.toFixed(2)
}

async function readAccount(fetchImpl: FetchLike, token: string): Promise<OllamaAccount | undefined> {
  try {
    const response = await fetchImpl('https://ollama.com/api/me', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    const body: unknown = await response.json()
    if (!isRecord(body)) return undefined
    const createdAt = stringField(body, 'CreatedAt', 'createdAt')
    const periodStart = stringField(body, 'SubscriptionPeriodStart', 'subscriptionPeriodStart')
    const periodEnd = stringField(body, 'SubscriptionPeriodEnd', 'subscriptionPeriodEnd')
    const planRaw = body['Plan'] ?? body['plan']
    const plan = typeof planRaw === 'string' && planRaw.length > 0 ? titleCase(planRaw) : undefined
    if (createdAt === undefined && plan === undefined && periodStart === undefined && periodEnd === undefined)
      return undefined
    return {
      ...createdAt === undefined ? {} : { createdAt },
      ...periodStart === undefined ? {} : { periodStart },
      ...periodEnd === undefined ? {} : { periodEnd },
      ...plan === undefined ? {} : { plan },
    }
  } catch {
    return undefined
  }
}

async function pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields> {
  const headers = {
    authorization: `Bearer ${access.token}`,
    accept: 'application/json',
  }
  const [body, account] = await Promise.all([
    getJson(fetchImpl, 'https://ollama.com/api/usage', headers),
    readAccount(fetchImpl, access.token),
  ])
  return parseOllamaUsage(body, now, account)
}

export const ollamaCloud: ProviderAdapter = { identity, pull }
