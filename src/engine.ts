import { IDENTITIES, type ProviderSnapshot, type PubSettings, type Snapshot } from './snapshot.ts'
import {
  defaultStore,
  loadPubCredentials,
  parseSettings,
  pubConfigDir,
  readClaudeAccess,
  readCodexAccess,
  readCursorAccess,
  readGrokAccess,
  readOllamaKey,
  readOptional,
  type CredentialStore,
  type PubCredential,
} from './credentials.ts'
import { parseClaudeUsage } from './providers/claude.ts'
import { parseCodexUsage } from './providers/codex.ts'
import { parseCursorUsage } from './providers/cursor.ts'
import { parseGrokUsage } from './providers/grok.ts'
import { parseOllamaUsage } from './providers/ollama.ts'
import { join } from 'node:path'

export interface FetchLike {
  (url: string, init: RequestInit): Promise<Response>
}

export interface SnapshotRequest {
  settings: PubSettings
  store?: CredentialStore
  fetch?: FetchLike
  now?: () => number
  configDir?: string
  previous?: Snapshot
}

const TIMEOUT_MS = 15_000

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
    const identity = IDENTITIES[row.id]
    if (identity === undefined) continue
    const next = await readProvider(row.id, row.pinned, identity, store, pub[row.id], fetchImpl, now, fetchedAt)
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
  if (next.error === undefined || next.error === 'signed out' || previous === undefined)
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
  }
}

async function readProvider(
  id: string,
  pinned: boolean,
  identity: (typeof IDENTITIES)[string],
  store: CredentialStore,
  pub: PubCredential | undefined,
  fetchImpl: FetchLike,
  now: number,
  fetchedAt: string,
): Promise<ProviderSnapshot> {
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
  try {
    if (id === 'claude') {
      const access = await readClaudeAccess(store, pub)
      if (access === undefined) return { ...base, error: 'signed out' }
      const body = await getJson(fetchImpl, 'https://api.anthropic.com/api/oauth/usage?at_wall=1&skip_spend=1', {
        authorization: `Bearer ${access.token}`,
        accept: 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'user-agent': 'pub-engine',
      })
      return { ...base, ...parseClaudeUsage(body, now, access.plan), credentialSource: access.source }
    }
    if (id === 'codex') {
      const access = await readCodexAccess(store, pub)
      if (access === undefined) return { ...base, error: 'signed out' }
      const body = await getJson(fetchImpl, 'https://chatgpt.com/backend-api/wham/usage', {
        authorization: `Bearer ${access.token}`,
        'chatgpt-account-id': access.accountId,
        accept: 'application/json',
        'cache-control': 'no-store',
        'user-agent': 'pub-engine',
      })
      return { ...base, ...parseCodexUsage(body, now), credentialSource: access.source }
    }
    if (id === 'cursor') {
      const access = await readCursorAccess(store, pub)
      if (access === undefined) return { ...base, error: 'signed out' }
      const cookie = access.userId === undefined
        ? undefined
        : `WorkosCursorSessionToken=${encodeURIComponent(`${access.userId}::${access.token}`)}`
      const body = await getJson(fetchImpl, 'https://cursor.com/api/usage-summary', {
        accept: 'application/json',
        ...cookie === undefined ? {} : { cookie },
      })
      return { ...base, ...parseCursorUsage(body, now), credentialSource: access.source }
    }
    if (id === 'grok') {
      const access = await readGrokAccess(store, pub)
      if (access === undefined) return { ...base, error: 'signed out' }
      const body = await getJson(fetchImpl, 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
        authorization: `Bearer ${access.token}`,
        accept: 'application/json',
        'x-grok-client-version': '1.0.30',
        'x-grok-client-identifier': 'grok-shell',
      })
      const settings = await getJsonOptional(fetchImpl, 'https://cli-chat-proxy.grok.com/v1/settings', {
        authorization: `Bearer ${access.token}`,
        accept: 'application/json',
        'x-grok-client-version': '1.0.30',
        'x-grok-client-identifier': 'grok-shell',
      })
      const plan = isSettingsPlan(settings)
      return { ...base, ...parseGrokUsage(body, now, plan), credentialSource: access.source }
    }
    if (id === 'ollama-cloud') {
      const key = await readOllamaKey(store, pub)
      if (key === undefined) return { ...base, error: 'signed out' }
      const body = await getJson(fetchImpl, 'https://ollama.com/api/usage', {
        authorization: `Bearer ${key.token}`,
        accept: 'application/json',
      })
      return { ...base, ...parseOllamaUsage(body, now), credentialSource: key.source }
    }
    return { ...base, error: 'unknown provider' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'usage read failed'
    return { ...base, error: message }
  }
}

function isSettingsPlan(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const plan = (value as Record<string, unknown>)['subscription_tier_display']
  return typeof plan === 'string' && plan.length > 0 ? plan : undefined
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`HTTP ${String(response.status)}`)
  }
  return await response.json()
}

async function getJsonOptional(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<unknown | undefined> {
  try {
    return await getJson(fetchImpl, url, headers)
  } catch {
    return undefined
  }
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
