import type { ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedPercent, resetLabel, isoInstant, toNumber } from '../remaining.ts'

export function parseCursorUsage(
  body: unknown,
  now: number,
): Pick<ProviderSnapshot, 'plan' | 'remaining' | 'windows' | 'extraNote'> {
  if (!isRecord(body) || !isRecord(body['individualUsage'])) {
    throw new Error('Cursor usage-summary has no individualUsage')
  }
  const individual = body['individualUsage']
  const plan = isRecord(individual['plan']) ? individual['plan'] : undefined
  const onDemand = isRecord(individual['onDemand']) ? individual['onDemand'] : undefined
  const resetsAt = isoInstant(body['billingCycleEnd'])
  const reset = resetLabel(resetsAt, now)
  const windows: QuotaWindow[] = []
  const auto = plan === undefined ? undefined : toNumber(plan['autoPercentUsed'])
  const api = plan === undefined ? undefined : toNumber(plan['apiPercentUsed'])
  const total = plan === undefined ? undefined : toNumber(plan['totalPercentUsed'])
  if (auto !== undefined) {
    windows.push({
      id: 'cursor-models',
      label: 'Cursor Models',
      remaining: remainingFromUsedPercent(auto),
      ...resetsAt === undefined ? {} : { resetsAt },
      resetLabel: reset,
      primary: false,
    })
  }
  if (api !== undefined) {
    windows.push({
      id: 'other-models',
      label: 'Other Models',
      remaining: remainingFromUsedPercent(api),
      ...resetsAt === undefined ? {} : { resetsAt },
      resetLabel: reset,
      primary: false,
    })
  }
  if (windows.length === 0) throw new Error('Cursor usage-summary listed no quota windows')
  const remaining = total === undefined
    ? windows[0]!.remaining
    : remainingFromUsedPercent(total)
  const membership = body['membershipType']
  const extraNote = onDemand !== undefined && onDemand['enabled'] === false ? 'On-demand off' : undefined
  return {
    ...typeof membership === 'string' && membership.length > 0 ? { plan: titleCase(membership) } : {},
    remaining,
    windows,
    ...extraNote === undefined ? {} : { extraNote },
  }
}

function titleCase(value: string): string {
  if (value.length === 0) return value
  return value[0]!.toUpperCase() + value.slice(1)
}
