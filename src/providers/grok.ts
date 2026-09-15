import type { ProviderAccess } from '../credentials.ts'
import { getJson, getJsonOptional, type FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedPercent, resetLabel, isoInstant } from '../remaining.ts'
import type { ProviderAdapter, UsageFields } from './types.ts'

export const identity: ProviderIdentity = {
  id: 'grok',
  name: 'Grok',
  accent: '#111111',
  usageUrl: 'https://grok.com/?_s=usage',
  statusUrl: 'https://status.x.ai',
}

function parseGrokUsage(
  body: unknown,
  now: number,
  plan?: string,
): Pick<ProviderSnapshot, 'plan' | 'remaining' | 'windows'> {
  if (!isRecord(body) || !isRecord(body['config'])) {
    throw new Error('Grok billing reply has no config')
  }
  const config = body['config']
  const current = isRecord(config['currentPeriod']) ? config['currentPeriod'] : undefined
  const resetsAt = isoInstant(current?.['end'] ?? config['billingPeriodEnd'])
  const percent = config['creditUsagePercent']
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    throw new Error('Grok billing reply has no creditUsagePercent')
  }
  const remaining = remainingFromUsedPercent(percent)
  const window: QuotaWindow = {
    id: 'weekly',
    label: 'Weekly',
    remaining,
    ...resetsAt === undefined ? {} : { resetsAt },
    resetLabel: resetLabel(resetsAt, now),
    primary: true,
  }
  return {
    ...typeof plan === 'string' && plan.length > 0 ? { plan } : { plan: 'SuperGrok' },
    remaining,
    windows: [window],
  }
}

function isSettingsPlan(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const plan = (value as Record<string, unknown>)['subscription_tier_display']
  return typeof plan === 'string' && plan.length > 0 ? plan : undefined
}

async function pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields> {
  const headers = {
    authorization: `Bearer ${access.token}`,
    accept: 'application/json',
    'x-grok-client-version': '1.0.30',
    'x-grok-client-identifier': 'grok-shell',
  }
  const body = await getJson(fetchImpl, 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', headers)
  const settings = await getJsonOptional(fetchImpl, 'https://cli-chat-proxy.grok.com/v1/settings', headers)
  return parseGrokUsage(body, now, isSettingsPlan(settings))
}

export const grok: ProviderAdapter = { identity, pull }
