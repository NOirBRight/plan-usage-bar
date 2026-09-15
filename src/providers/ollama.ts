import type { ProviderSnapshot, QuotaWindow } from '../snapshot.ts'
import { isRecord, remainingFromUsedFraction, resetLabel, isoInstant } from '../remaining.ts'

const LIMIT_LABEL: Record<string, string> = {
  session: '5-hour',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

export function parseOllamaUsage(
  body: unknown,
  now: number,
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
    const resetsAt = isoInstant(value['resets_at'] ?? value['resetsAt'])
      ?? (typeof value['reset_after_seconds'] === 'number'
        ? new Date(now + value['reset_after_seconds'] * 1000).toISOString()
        : undefined)
    windows.push({
      id: key,
      label: LIMIT_LABEL[key] ?? titleCase(key),
      remaining: remainingFromUsedFraction(usage),
      ...resetsAt === undefined ? {} : { resetsAt },
      resetLabel: resetLabel(resetsAt, now),
      primary: key === 'weekly' || key === 'monthly',
    })
  }
  if (windows.length === 0) throw new Error('Ollama usage reply listed no quota windows')
  if (!windows.some(window => window.primary)) windows[0]!.primary = true
  const primary = windows.find(window => window.primary) ?? windows[0]!
  const activity = isRecord(body['activity']) ? body['activity'] : undefined
  const costValue = activity !== undefined && typeof activity['cost'] === 'string' ? activity['cost'] : undefined
  const hasSession = windows.some(window => window.id === 'session')
  const hasWeekly = windows.some(window => window.id === 'weekly')
  const note = !hasSession && hasWeekly
    ? undefined
    : !hasWeekly && !hasSession
      ? '本机 limits 只返回了 Monthly。Free 通常只有 Weekly；Pro/Max 会多出 5-hour Session。有什么画什么。'
      : undefined
  return {
    remaining: primary.remaining,
    windows,
    ...costValue === undefined ? {} : { cost: { month: `$${trimCost(costValue)} · last 4 weeks` } },
    ...note === undefined ? {} : { note },
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
