import type { ProviderAccess } from '../credentials.ts'
import { getJson, type FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedFraction, resetLabel, isoInstant } from '../remaining.ts'
import type { ProviderAdapter, UsageFields } from './types.ts'

export const identity: ProviderIdentity = {
  id: 'opencode-go',
  name: 'OpenCode Go',
  accent: '#FF5C00',
  usageUrl: 'https://opencode.ai',
  statusUrl: 'https://opencode.ai',
}

const WINDOW_IDS = [
  { keys: ['rolling', 'rollingUsage', 'session'], id: 'session', label: '5-hour' },
  { keys: ['weekly', 'weeklyUsage'], id: 'weekly', label: 'Weekly' },
  { keys: ['monthly', 'monthlyUsage'], id: 'monthly', label: 'Monthly' },
] as const

function usedFraction(value: Record<string, unknown>): number | undefined {
  const percent = value['percent']
  if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0)
    return percent / 100
  const usagePercent = value['usagePercent']
  if (typeof usagePercent === 'number' && Number.isFinite(usagePercent) && usagePercent >= 0)
    return usagePercent / 100
  const usage = value['usage']
  if (typeof usage === 'number' && Number.isFinite(usage) && usage >= 0)
    return usage > 1 ? usage / 100 : usage
}

function parseWindow(
  value: unknown,
  id: string,
  label: string,
  now: number,
): QuotaWindow | undefined {
  if (!isRecord(value)) return undefined
  const status = value['status']
  if (status !== undefined && status !== 'ok' && status !== 'rate-limited') return undefined
  const used = usedFraction(value)
  if (used === undefined) return undefined
  const resetsAt = isoInstant(value['resetsAt'] ?? value['resets_at'] ?? value['resetAt'])
  return {
    id,
    label,
    remaining: remainingFromUsedFraction(used),
    ...resetsAt === undefined ? {} : { resetsAt },
    resetLabel: resetLabel(resetsAt, now),
    primary: id === 'monthly',
  }
}

function parseOpenCodeGoUsage(
  body: unknown,
  now: number,
): Pick<ProviderSnapshot, 'remaining' | 'windows'> {
  const root = isRecord(body) && isRecord(body['usage']) ? body['usage'] : body
  if (!isRecord(root)) throw new Error('OpenCode Go usage reply has no windows')
  const windows: QuotaWindow[] = []
  for (const spec of WINDOW_IDS) {
    let parsed: QuotaWindow | undefined
    for (const key of spec.keys) {
      parsed = parseWindow(root[key], spec.id, spec.label, now)
      if (parsed !== undefined) break
    }
    if (parsed !== undefined) windows.push(parsed)
  }
  if (windows.length === 0) throw new Error('OpenCode Go usage reply listed no quota windows')
  if (!windows.some(window => window.primary)) windows[0]!.primary = true
  const primary = windows.find(window => window.primary) ?? windows[0]!
  return { remaining: primary.remaining, windows }
}

async function pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields> {
  const body = await getJson(fetchImpl, 'https://opencode.ai/zen/go/v1/usage', {
    authorization: `Bearer ${access.token}`,
    accept: 'application/json',
    'user-agent': 'pub-engine',
    'x-opencode-session': 'ses_pub-usage',
  })
  return parseOpenCodeGoUsage(body, now)
}

export const openCodeGo: ProviderAdapter = { identity, pull }
