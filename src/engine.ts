import { parseSettings, type ProviderSnapshot, type PubSettings, type Snapshot, type SnapshotErrorKind } from './snapshot.ts'
import {
  defaultStore,
  loadPubCredentials,
  pubConfigDir,
  readOptional,
  resolveAccess,
  type CredentialStore,
} from './credentials.ts'
import { HttpError, type FetchLike } from './http.ts'
import { claude } from './providers/claude.ts'
import { codex } from './providers/codex.ts'
import { cursor } from './providers/cursor.ts'
import { grok } from './providers/grok.ts'
import { ollamaCloud } from './providers/ollama.ts'
import { openCodeGo } from './providers/opencode-go.ts'
import { commandCode } from './providers/commandcode.ts'
import type { ProviderAdapter } from './providers/types.ts'
import { join } from 'node:path'

export interface SnapshotRequest {
  settings: PubSettings
  store?: CredentialStore
  fetch?: FetchLike
  now?: () => number
  configDir?: string
  previous?: Snapshot
}

const ADAPTERS: Record<string, ProviderAdapter> = {
  claude,
  codex,
  cursor,
  grok,
  'ollama-cloud': ollamaCloud,
  'opencode-go': openCodeGo,
  commandcode: commandCode,
}

export async function readSnapshot(request: SnapshotRequest): Promise<Snapshot> {
  const store = request.store ?? defaultStore()
  const fetchImpl = request.fetch ?? fetch
  const now = (request.now ?? Date.now)()
  const fetchedAt = new Date(now).toISOString()
  const configDir = request.configDir ?? pubConfigDir(store)
  const pub = await loadPubCredentials(store, configDir)
  const previousById = new Map((request.previous?.providers ?? []).map(provider => [provider.id, provider]))
  const providers: ProviderSnapshot[] = []
  for (const row of request.settings.providers) {
    if (!row.enabled) continue
    const adapter = ADAPTERS[row.id]
    if (adapter === undefined) continue
    const next = await readProvider(row.id, row.pinned, adapter, store, pub[row.id], fetchImpl, now, fetchedAt)
    providers.push(applyPrimary(keepLastGood(next, previousById.get(row.id)), row.primary))
  }
  return {
    fetchedAt,
    remainingMode: request.settings.remainingMode,
    providers,
  }
}

/** Apply the user's Primary Window choice; unknown ids keep the provider default. */
export function applyPrimary(provider: ProviderSnapshot, windowId?: string): ProviderSnapshot {
  if (windowId === undefined) return provider
  const target = provider.windows.find(window => window.id === windowId)
  if (target === undefined) return provider
  return {
    ...provider,
    remaining: target.remaining,
    windows: provider.windows.map(window => ({ ...window, primary: window.id === windowId })),
  }
}

export function keepLastGood(next: ProviderSnapshot, previous?: ProviderSnapshot): ProviderSnapshot {
  if (next.errorKind === 'signed-out' || next.error === 'signed out' || previous === undefined)
    return next
  if (next.error === undefined && next.errorKind === undefined)
    return next
  if (previous.remaining === null || previous.remaining === undefined)
    return next
  return {
    ...next,
    remaining: previous.remaining,
    windows: previous.windows.length > 0 ? previous.windows : next.windows,
    plan: next.plan ?? previous.plan,
    extra: next.extra ?? previous.extra,
    extraNote: next.extraNote ?? previous.extraNote,
    cost: next.cost ?? previous.cost,
    credentialSource: next.credentialSource ?? previous.credentialSource,
    fetchedAt: previous.fetchedAt,
  }
}

async function readProvider(
  id: string,
  pinned: boolean,
  adapter: ProviderAdapter,
  store: CredentialStore,
  pub: Parameters<typeof resolveAccess>[2],
  fetchImpl: FetchLike,
  now: number,
  fetchedAt: string,
): Promise<ProviderSnapshot> {
  const identity = adapter.identity
  const base: ProviderSnapshot = {
    id: identity.id,
    name: identity.name,
    pinned,
    accent: identity.accent,
    fetchedAt,
    usageUrl: identity.usageUrl,
    statusUrl: identity.statusUrl,
    remaining: null,
    windows: [],
  }
  let access
  try {
    access = await resolveAccess(id, store, pub)
  } catch (error) {
    return { ...base, ...classifyFetchError(error) }
  }
  if (access === undefined)
    return { ...base, error: 'signed out', errorKind: 'signed-out' }
  try {
    const usage = await adapter.pull(access, fetchImpl, now)
    return { ...base, ...usage, credentialSource: access.source }
  } catch (error) {
    return { ...base, credentialSource: access.source, ...classifyFetchError(error) }
  }
}

function classifyFetchError(error: unknown): { error: string, errorKind: SnapshotErrorKind } {
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403)
      return { error: error.message, errorKind: 'unauthorized' }
    if (error.status === 429)
      return { error: error.message, errorKind: 'rate-limit' }
    return { error: error.message, errorKind: 'transport' }
  }
  const message = error instanceof Error ? error.message : 'usage read failed'
  return { error: message, errorKind: 'transport' }
}

export async function loadSettings(store: CredentialStore, configDir: string): Promise<PubSettings> {
  const text = await readOptional(store, join(configDir, 'settings.json'))
  if (text === undefined) return parseSettings(undefined)
  try {
    return parseSettings(JSON.parse(text) as unknown)
  } catch {
    return parseSettings(undefined)
  }
}
