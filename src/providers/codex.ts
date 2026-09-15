import type { ProviderAccess } from '../credentials.ts'
import { getJson, type FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedPercent, resetLabel, isoInstant } from '../remaining.ts'
import type { ProviderAdapter, UsageFields } from './types.ts'

export const identity: ProviderIdentity = {
  id: 'codex',
  name: 'Codex',
  accent: '#10a37f',
  usageUrl: 'https://chatgpt.com/#settings',
  statusUrl: 'https://status.openai.com',
}

function parseCodexUsage(
  body: unknown,
  now: number,
): Pick<ProviderSnapshot, 'plan' | 'remaining' | 'windows'> {
  if (!isRecord(body)) throw new Error('Codex usage reply is not an object')
  const windows: QuotaWindow[] = []
  appendLimit(windows, body['rate_limit'], undefined, now)
  const additional = body['additional_rate_limits']
  if (Array.isArray(additional)) {
    for (const item of additional) {
      if (!isRecord(item)) continue
      const name = item['limit_name']
      const prefix = typeof name === 'string' ? sparkPrefix(name) : undefined
      appendLimit(windows, item['rate_limit'], prefix, now)
    }
  }
  if (windows.length === 0) throw new Error('Codex usage reply listed no quota windows')
  const primary = windows.find(window => window.primary) ?? windows[0]!
  const plan = body['plan_type']
  return {
    ...typeof plan === 'string' && plan.length > 0 ? { plan: titleCase(plan) } : {},
    remaining: primary.remaining,
    windows,
  }
}

function appendLimit(
  windows: QuotaWindow[],
  value: unknown,
  prefix: string | undefined,
  now: number,
): void {
  if (!isRecord(value)) return
  const rows = [value['primary_window'], value['secondary_window']]
  for (const row of rows) {
    const window = parseWindow(row, prefix, now)
    if (window !== undefined) windows.push(window)
  }
}

function parseWindow(value: unknown, prefix: string | undefined, now: number): QuotaWindow | undefined {
  if (!isRecord(value)) return undefined
  const usedPercent = value['used_percent']
  const windowSeconds = value['limit_window_seconds']
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return undefined
  if (typeof windowSeconds !== 'number' || !Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    return undefined
  }
  const resetsAt = isoInstant(value['reset_at'] ?? value['resetsAt'])
    ?? (typeof value['reset_after_seconds'] === 'number'
      ? new Date(now + value['reset_after_seconds'] * 1000).toISOString()
      : undefined)
  const span = spanLabel(windowSeconds)
  const label = prefix === undefined ? span : `${prefix} · ${span}`
  const id = prefix === undefined ? span.toLowerCase() : `${prefix.toLowerCase()}-${span.toLowerCase()}`
  const remaining = remainingFromUsedPercent(usedPercent)
  return {
    id,
    label,
    remaining,
    ...resetsAt === undefined ? {} : { resetsAt },
    resetLabel: resetLabel(resetsAt, now),
    primary: prefix === undefined && windowSeconds >= 604800,
  }
}

function spanLabel(windowSeconds: number): string {
  if (windowSeconds === 18_000) return '5-hour'
  if (windowSeconds === 604_800) return 'Weekly'
  if (windowSeconds % 86400 === 0) return `${windowSeconds / 86400}-day`
  return `${Math.round(windowSeconds / 3600)}-hour`
}

function sparkPrefix(limitName: string): string {
  if (/spark/iu.test(limitName)) return 'Spark'
  return limitName
}

function titleCase(value: string): string {
  if (value.length === 0) return value
  return value[0]!.toUpperCase() + value.slice(1)
}

async function pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields> {
  const accountId = access.accountId
  if (accountId === undefined) throw new Error('Codex access has no accountId')
  const body = await getJson(fetchImpl, 'https://chatgpt.com/backend-api/wham/usage', {
    authorization: `Bearer ${access.token}`,
    'chatgpt-account-id': accountId,
    accept: 'application/json',
    'cache-control': 'no-store',
    'user-agent': 'pub-engine',
  })
  return parseCodexUsage(body, now)
}

export const codex: ProviderAdapter = { identity, pull }
