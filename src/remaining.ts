/** Remaining fractions and reset captions for the Snapshot. */

export function remainingFromUsedPercent(usedPercent: number): number {
  const used = Math.min(100, Math.max(0, usedPercent))
  return (100 - used) / 100
}

export function remainingFromUsedFraction(used: number): number {
  return Math.min(1, Math.max(0, 1 - used))
}

/** Floor to days then hours, matching the validated prototype captions. */
export function resetLabel(resetsAt: string | undefined, now: number): string {
  if (resetsAt === undefined) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'Resets soon'
  const totalMin = Math.floor(ms / 60_000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const minutes = totalMin % 60
  if (days > 0) return `Resets in ${days}d ${hours}h`
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`
  return `Resets in ${minutes}m`
}

export function isoInstant(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
}
