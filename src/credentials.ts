import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type PubSettings, type ProviderSettings } from './snapshot.ts'
import { isRecord } from './remaining.ts'

export interface CredentialStore {
  readFile(path: string): Promise<string>
  env: NodeJS.ProcessEnv
  home: string
}

export interface PubCredential {
  token: string
  accountId?: string
  userId?: string
  plan?: string
}

export function defaultStore(): CredentialStore {
  return {
    readFile: async (path: string) => (await import('node:fs/promises')).readFile(path, 'utf8'),
    env: process.env,
    home: homedir(),
  }
}

export function pubConfigDir(store: CredentialStore): string {
  const xdg = store.env['XDG_CONFIG_HOME']
  if (typeof xdg === 'string' && xdg.length > 0)
    return join(xdg, 'pub')
  return join(store.home, '.config', 'pub')
}

export async function readOptional(store: CredentialStore, path: string): Promise<string | undefined> {
  try {
    return await store.readFile(path)
  } catch (error) {
    if (isNodeErrno(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function isNodeErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

export async function readJsonFile(store: CredentialStore, path: string): Promise<unknown | undefined> {
  const text = await readOptional(store, path)
  if (text === undefined) return undefined
  return JSON.parse(text) as unknown
}

export function parsePubCredentials(value: unknown): Record<string, PubCredential> {
  if (!isRecord(value)) return {}
  const parsed: Record<string, PubCredential> = {}
  for (const [id, item] of Object.entries(value)) {
    if (!isRecord(item)) continue
    const token = typeof item['token'] === 'string' ? item['token'].trim() : ''
    if (token.length === 0) continue
    const credential: PubCredential = { token }
    const accountId = item['accountId']
    const userId = item['userId']
    const plan = item['plan']
    if (typeof accountId === 'string' && accountId.trim().length > 0)
      credential.accountId = accountId.trim()
    if (typeof userId === 'string' && userId.trim().length > 0)
      credential.userId = userId.trim()
    if (typeof plan === 'string' && plan.trim().length > 0)
      credential.plan = plan.trim()
    const split = splitUserToken(credential.token)
    if (credential.userId === undefined && split !== undefined) {
      credential.userId = split.userId
      credential.token = split.token
    }
    parsed[id] = credential
  }
  return parsed
}

function splitUserToken(value: string): { userId: string, token: string } | undefined {
  const index = value.indexOf('::')
  if (index <= 0 || index === value.length - 2) return undefined
  const userId = value.slice(0, index).trim()
  const token = value.slice(index + 2).trim()
  if (userId.length === 0 || token.length === 0) return undefined
  return { userId, token }
}

export async function loadPubCredentials(store: CredentialStore, configDir: string): Promise<Record<string, PubCredential>> {
  const value = await readJsonFile(store, join(configDir, 'credentials.json'))
  return parsePubCredentials(value)
}

export async function readClaudeAccess(
  store: CredentialStore,
  pub?: PubCredential,
): Promise<{ token: string, plan?: string, source: 'pub' | 'cli' } | undefined> {
  if (pub !== undefined)
    return { token: pub.token, source: 'pub', ...pub.plan === undefined ? {} : { plan: pub.plan } }
  const value = await readJsonFile(store, join(store.home, '.claude', '.credentials.json'))
  if (!isRecord(value) || !isRecord(value['claudeAiOauth'])) return undefined
  const oauth = value['claudeAiOauth']
  const token = oauth['accessToken']
  const plan = oauth['subscriptionType']
  if (typeof token !== 'string' || token.length === 0) return undefined
  return { token, source: 'cli', ...typeof plan === 'string' ? { plan } : {} }
}

export async function readCodexAccess(
  store: CredentialStore,
  pub?: PubCredential,
): Promise<{ token: string, accountId: string, source: 'pub' | 'cli' } | undefined> {
  if (pub !== undefined && pub.accountId !== undefined)
    return { token: pub.token, accountId: pub.accountId, source: 'pub' }
  const official = await readJsonFile(store, join(store.home, '.codex', 'auth.json'))
  if (isRecord(official) && isRecord(official['tokens'])) {
    const tokens = official['tokens']
    const token = tokens['access_token']
    const accountId = tokens['account_id']
    if (typeof token === 'string' && token.length > 0 && typeof accountId === 'string' && accountId.length > 0) {
      return { token, accountId, source: 'cli' }
    }
  }
  return undefined
}

export async function readCursorAccess(
  store: CredentialStore,
  pub?: PubCredential,
): Promise<{ token: string, userId?: string, source: 'pub' | 'cli' } | undefined> {
  if (pub !== undefined)
    return { token: pub.token, source: 'pub', ...pub.userId === undefined ? {} : { userId: pub.userId } }
  return undefined
}

export async function readGrokAccess(
  store: CredentialStore,
  pub?: PubCredential,
): Promise<{ token: string, source: 'pub' | 'cli' } | undefined> {
  if (pub !== undefined)
    return { token: pub.token, source: 'pub' }
  const official = await readJsonFile(store, join(store.home, '.grok', 'auth.json'))
  if (isRecord(official)) {
    for (const value of Object.values(official)) {
      if (!isRecord(value)) continue
      const token = value['key'] ?? value['accessToken']
      if (typeof token === 'string' && token.length > 0) return { token, source: 'cli' }
    }
  }
  return undefined
}

export async function readOllamaKey(
  store: CredentialStore,
  pub?: PubCredential,
): Promise<{ token: string, source: 'pub' | 'cli' } | undefined> {
  if (pub !== undefined)
    return { token: pub.token, source: 'pub' }
  const envKey = store.env['OLLAMA_API_KEY']
  if (typeof envKey === 'string' && envKey.length > 0) return { token: envKey, source: 'cli' }
  return undefined
}

export function parseSettings(value: unknown): PubSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS
  const remainingMode = value['remainingMode']
  const providers = value['providers']
  if (!Array.isArray(providers)) return DEFAULT_SETTINGS
  const parsed: ProviderSettings[] = []
  for (const item of providers) {
    if (!isRecord(item)) continue
    const id = item['id']
    if (typeof id !== 'string' || id.length === 0) continue
    const primary = item['primary']
    parsed.push({
      id,
      enabled: item['enabled'] !== false,
      pinned: item['pinned'] === true,
      ...typeof primary === 'string' && primary.length > 0 ? { primary } : {},
    })
  }
  if (parsed.length === 0) return DEFAULT_SETTINGS
  return {
    remainingMode: remainingMode !== false,
    providers: parsed,
  }
}
