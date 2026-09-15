import type { ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedPercent, resetLabel, isoInstant } from '../remaining.ts'

export function parseGrokUsage(
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
