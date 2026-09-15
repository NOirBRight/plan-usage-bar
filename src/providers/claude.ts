import type { ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedPercent, resetLabel, isoInstant } from '../remaining.ts'

const KIND_LABEL: Record<string, string> = {
  session: 'Session',
  weekly_all: 'Weekly',
  weekly: 'Weekly',
}

export function parseClaudeUsage(
  body: unknown,
  now: number,
  plan?: string,
): Pick<ProviderSnapshot, 'plan' | 'remaining' | 'windows' | 'extra' | 'extraNote'> {
  if (!isRecord(body) || !Array.isArray(body['limits'])) {
    throw new Error('Claude usage reply has no limits')
  }
  const windows: QuotaWindow[] = []
  for (const item of body['limits']) {
    if (!isRecord(item)) continue
    const kind = item['kind']
    const percent = item['percent']
    if (typeof kind !== 'string' || kind.length === 0) continue
    if (typeof percent !== 'number' || !Number.isFinite(percent)) continue
    const label = KIND_LABEL[kind] ?? kind
    const resetsAt = isoInstant(item['resets_at'])
    windows.push({
      id: kind,
      label,
      remaining: remainingFromUsedPercent(percent),
      ...resetsAt === undefined ? {} : { resetsAt },
      resetLabel: resetLabel(resetsAt, now),
      primary: kind === 'weekly_all' || kind === 'weekly',
    })
  }
  if (windows.length === 0) throw new Error('Claude usage reply listed no quota windows')
  if (!windows.some(window => window.primary)) windows[0]!.primary = true
  const primary = windows.find(window => window.primary) ?? windows[0]!
  const extra = parseExtra(body['extra_usage'])
  return {
    ...typeof plan === 'string' && plan.length > 0 ? { plan: titleCase(plan) } : {},
    remaining: primary.remaining,
    windows,
    ...extra,
  }
}

function parseExtra(
  value: unknown,
): Pick<ProviderSnapshot, 'extra' | 'extraNote'> {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) return {}
  const utilization = value['utilization']
  if (typeof utilization === 'number' && Number.isFinite(utilization)) {
    const used = utilization > 1 ? utilization / 100 : utilization
    return { extra: { label: 'Extra usage', usedFraction: used } }
  }
  return {}
}

function titleCase(value: string): string {
  if (value.length === 0) return value
  return value[0]!.toUpperCase() + value.slice(1)
}
