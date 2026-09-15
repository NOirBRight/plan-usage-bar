import type { ProviderAccess } from '../credentials.ts'
import { getJson, type FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedPercent, resetLabel, isoInstant, toNumber } from '../remaining.ts'
import type { ProviderAdapter, UsageFields } from './types.ts'

export const identity: ProviderIdentity = {
  id: 'cursor',
  name: 'Cursor',
  accent: '#111111',
  usageUrl: 'https://cursor.com/dashboard',
  statusUrl: 'https://status.cursor.com',
}

function parseCursorUsage(
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
  if (total !== undefined) {
    windows.push({
      id: 'total',
      label: 'Total',
      remaining,
      ...resetsAt === undefined ? {} : { resetsAt },
      resetLabel: reset,
      primary: true,
    })
  } else if (!windows.some(window => window.primary)) {
    windows[0]!.primary = true
  }
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

async function pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields> {
  const userId = access.userId
  if (userId === undefined) throw new Error('Cursor access has no userId')
  const cookie = `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${access.token}`)}`
  const body = await getJson(fetchImpl, 'https://cursor.com/api/usage-summary', {
    accept: 'application/json',
    cookie,
  })
  return parseCursorUsage(body, now)
}

export const cursor: ProviderAdapter = { identity, pull }
