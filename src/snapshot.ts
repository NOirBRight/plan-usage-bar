/** Snapshot JSON the GNOME extension reads. Engine-only types. */

import { isRecord } from './remaining.ts'

export interface QuotaWindow {
  id: string
  label: string
  remaining: number | null
  resetsAt?: string
  resetLabel: string
  primary: boolean
}

export type CredentialSource = 'pub' | 'cli' | 'env'

export type SnapshotErrorKind = 'signed-out' | 'unauthorized' | 'rate-limit' | 'transport'

export interface ProviderSnapshot {
  id: string
  name: string
  plan?: string
  pinned: boolean
  remaining: number | null
  accent: string
  fetchedAt: string
  usageUrl: string
  statusUrl: string
  extra?: { label: string, usedFraction: number }
  extraNote?: string
  cost?: { today?: string, month?: string }
  note?: string
  error?: string
  errorKind?: SnapshotErrorKind
  credentialSource?: CredentialSource
  windows: QuotaWindow[]
}

export interface Snapshot {
  fetchedAt: string
  remainingMode: boolean
  providers: ProviderSnapshot[]
}

export interface ProviderSettings {
  id: string
  enabled: boolean
  pinned: boolean
  /** Quota Window id chosen as Primary Window; absent = provider default. */
  primary?: string
}

export interface PubSettings {
  remainingMode: boolean
  providers: ProviderSettings[]
}

export const DEFAULT_SETTINGS: PubSettings = {
  remainingMode: true,
  providers: [
    { id: 'claude', enabled: true, pinned: true },
    { id: 'codex', enabled: true, pinned: true },
    { id: 'cursor', enabled: true, pinned: true },
    { id: 'grok', enabled: true, pinned: true },
    { id: 'ollama-cloud', enabled: true, pinned: false },
  ],
}

export interface ProviderIdentity {
  id: string
  name: string
  accent: string
  usageUrl: string
  statusUrl: string
}

function cloneDefaultProviders(): ProviderSettings[] {
  return DEFAULT_SETTINGS.providers.map(row => ({ ...row }))
}

/** Read-time merge: file wins for known rows, missing defaults append, duplicate ids keep the first. */
export function parseSettings(value: unknown): PubSettings {
  if (!isRecord(value)) {
    return { remainingMode: DEFAULT_SETTINGS.remainingMode, providers: cloneDefaultProviders() }
  }
  const raw = value['providers']
  if (!Array.isArray(raw)) {
    return { remainingMode: DEFAULT_SETTINGS.remainingMode, providers: cloneDefaultProviders() }
  }
  const parsed: ProviderSettings[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = item['id']
    if (typeof id !== 'string' || id.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    const primary = item['primary']
    parsed.push({
      id,
      enabled: item['enabled'] !== false,
      pinned: item['pinned'] === true,
      ...typeof primary === 'string' && primary.length > 0 ? { primary } : {},
    })
  }
  if (parsed.length === 0) {
    return { remainingMode: DEFAULT_SETTINGS.remainingMode, providers: cloneDefaultProviders() }
  }
  for (const row of DEFAULT_SETTINGS.providers) {
    if (seen.has(row.id)) continue
    parsed.push({ ...row })
  }
  return {
    remainingMode: value['remainingMode'] !== false,
    providers: parsed,
  }
}
