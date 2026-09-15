import { homedir } from 'node:os'
import { join } from 'node:path'
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

export type AccessSource = 'pub' | 'cli' | 'env'

export interface ProviderAccess {
  token: string
  source: AccessSource
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

export function splitUserToken(value: string): { userId: string, token: string } | undefined {
  const index = value.indexOf('::')
  if (index <= 0 || index === value.length - 2) return undefined
  const userId = value.slice(0, index).trim()
  const token = value.slice(index + 2).trim()
  if (userId.length === 0 || token.length === 0) return undefined
  return { userId, token }
}

export async function loadPubCredentials(
  store: CredentialStore,
  configDir: string,
): Promise<Record<string, PubCredential>> {
  const value = await readJsonFile(store, join(configDir, 'credentials.json'))
  return parsePubCredentials(value)
}

function claudeCredentialsPath(store: CredentialStore): string {
  const dir = store.env['CLAUDE_CONFIG_DIR']
  if (typeof dir === 'string' && dir.length > 0)
    return join(dir, '.credentials.json')
  return join(store.home, '.claude', '.credentials.json')
}

function codexAuthPath(store: CredentialStore): string {
  const dir = store.env['CODEX_HOME']
  if (typeof dir === 'string' && dir.length > 0)
    return join(dir, 'auth.json')
  return join(store.home, '.codex', 'auth.json')
}

async function claudeFromCli(store: CredentialStore): Promise<ProviderAccess | undefined> {
  const value = await readJsonFile(store, claudeCredentialsPath(store))
  if (!isRecord(value) || !isRecord(value['claudeAiOauth'])) return undefined
  const oauth = value['claudeAiOauth']
  const token = oauth['accessToken']
  const plan = oauth['subscriptionType']
  if (typeof token !== 'string' || token.length === 0) return undefined
  return { token, source: 'cli', ...typeof plan === 'string' ? { plan } : {} }
}

async function codexFromCli(store: CredentialStore): Promise<ProviderAccess | undefined> {
  const official = await readJsonFile(store, codexAuthPath(store))
  if (!isRecord(official) || !isRecord(official['tokens'])) return undefined
  const tokens = official['tokens']
  const token = tokens['access_token']
  const accountId = tokens['account_id']
  if (typeof token !== 'string' || token.length === 0) return undefined
  if (typeof accountId !== 'string' || accountId.length === 0) return undefined
  return { token, accountId, source: 'cli' }
}

async function grokFromCli(store: CredentialStore): Promise<ProviderAccess | undefined> {
  const official = await readJsonFile(store, join(store.home, '.grok', 'auth.json'))
  if (!isRecord(official)) return undefined
  for (const value of Object.values(official)) {
    if (!isRecord(value)) continue
    const token = value['key'] ?? value['accessToken']
    if (typeof token === 'string' && token.length > 0) return { token, source: 'cli' }
  }
  return undefined
}

function ollamaFromEnv(store: CredentialStore): ProviderAccess | undefined {
  const envKey = store.env['OLLAMA_API_KEY']
  if (typeof envKey === 'string' && envKey.length > 0) return { token: envKey, source: 'env' }
  return undefined
}

function pubClaude(pub: PubCredential): ProviderAccess {
  return { token: pub.token, source: 'pub', ...pub.plan === undefined ? {} : { plan: pub.plan } }
}

function pubCodex(pub: PubCredential): ProviderAccess | undefined {
  if (pub.accountId === undefined) return undefined
  return { token: pub.token, accountId: pub.accountId, source: 'pub' }
}

function pubCursor(pub: PubCredential): ProviderAccess | undefined {
  if (pub.userId === undefined) return undefined
  return { token: pub.token, userId: pub.userId, source: 'pub' }
}

function pubToken(pub: PubCredential): ProviderAccess {
  return { token: pub.token, source: 'pub' }
}

/** Resolve usable access for one Provider. Missing or incomplete PUB creds do not mix a CLI Account. */
export async function resolveAccess(
  id: string,
  store: CredentialStore,
  pub?: PubCredential,
): Promise<ProviderAccess | undefined> {
  if (id === 'claude') {
    if (pub !== undefined) return pubClaude(pub)
    return await claudeFromCli(store)
  }
  if (id === 'codex') {
    if (pub !== undefined) return pubCodex(pub)
    return await codexFromCli(store)
  }
  if (id === 'cursor') {
    if (pub !== undefined) return pubCursor(pub)
    return undefined
  }
  if (id === 'grok') {
    if (pub !== undefined) return pubToken(pub)
    return await grokFromCli(store)
  }
  if (id === 'ollama-cloud') {
    if (pub !== undefined) return pubToken(pub)
    return ollamaFromEnv(store)
  }
  return undefined
}
