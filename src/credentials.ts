import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeAtomic } from './atomic-write.ts'
import { stdin } from 'node:process'
import { catalogEntries } from './catalog.ts'
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
    const raw = typeof item['token'] === 'string' ? item['token'].trim() : ''
    const token = id === 'cursor' ? raw.replace(/^WorkosCursorSessionToken=/iu, '').trim() : raw
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
    if (credential.userId === undefined && id === 'cursor') {
      const fromJwt = userIdFromJwt(credential.token)
      if (fromJwt !== undefined)
        credential.userId = fromJwt
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

function userIdFromJwt(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as unknown
    if (!isRecord(payload) || typeof payload['sub'] !== 'string') return undefined
    const sub = payload['sub']
    const user = sub.includes('|') ? sub.slice(sub.lastIndexOf('|') + 1) : sub
    return user.startsWith('user_') ? user : undefined
  } catch {
    return undefined
  }
}

export async function loadPubCredentials(
  store: CredentialStore,
  configDir: string,
): Promise<Record<string, PubCredential>> {
  const value = await readJsonFile(store, join(configDir, 'credentials.json'))
  return parsePubCredentials(value)
}

function cursorAuthPath(store: CredentialStore): string {
  const xdg = store.env['XDG_CONFIG_HOME']
  if (typeof xdg === 'string' && xdg.length > 0)
    return join(xdg, 'cursor', 'auth.json')
  return join(store.home, '.config', 'cursor', 'auth.json')
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

async function cursorFromCli(store: CredentialStore): Promise<ProviderAccess | undefined> {
  const official = await readJsonFile(store, cursorAuthPath(store))
  if (!isRecord(official)) return undefined
  const token = typeof official['accessToken'] === 'string' ? official['accessToken'].trim() : ''
  if (token.length === 0) return undefined
  const userId = userIdFromJwt(token)
  if (userId === undefined) return undefined
  return { token, userId, source: 'cli' }
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

function xdgDataHome(store: CredentialStore): string {
  const xdg = store.env['XDG_DATA_HOME']
  if (typeof xdg === 'string' && xdg.length > 0)
    return xdg
  return join(store.home, '.local', 'share')
}

function envToken(store: CredentialStore, names: readonly string[]): ProviderAccess | undefined {
  for (const name of names) {
    const value = store.env[name]
    if (typeof value === 'string' && value.length > 0)
      return { token: value, source: 'env' }
  }
}

async function openCodeGoFromCli(store: CredentialStore): Promise<ProviderAccess | undefined> {
  const value = await readJsonFile(store, join(xdgDataHome(store), 'opencode', 'auth.json'))
  if (!isRecord(value) || !isRecord(value['opencode-go'])) return undefined
  const row = value['opencode-go']
  const token = row['key'] ?? row['apiKey']
  if (typeof token !== 'string' || token.length === 0) return undefined
  return { token, source: 'cli' }
}

async function commandCodeFromCli(store: CredentialStore): Promise<ProviderAccess | undefined> {
  const value = await readJsonFile(store, join(store.home, '.commandcode', 'auth.json'))
  if (!isRecord(value)) return undefined
  const token = value['apiKey']
  if (typeof token !== 'string' || token.length === 0) return undefined
  return { token, source: 'cli' }
}

function ollamaFromEnv(store: CredentialStore): ProviderAccess | undefined {
  return envToken(store, ['OLLAMA_API_KEY'])
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
    return await cursorFromCli(store)
  }
  if (id === 'grok') {
    if (pub !== undefined) return pubToken(pub)
    return await grokFromCli(store)
  }
  if (id === 'ollama-cloud') {
    if (pub !== undefined) return pubToken(pub)
    return ollamaFromEnv(store)
  }
  if (id === 'opencode-go') {
    if (pub !== undefined) return pubToken(pub)
    return await openCodeGoFromCli(store) ?? envToken(store, ['OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY'])
  }
  if (id === 'commandcode') {
    if (pub !== undefined) return pubToken(pub)
    return await commandCodeFromCli(store) ?? envToken(store, ['COMMAND_CODE_API_KEY', 'COMMANDCODE_API_KEY'])
  }
  return undefined
}

const CREDENTIALS_USAGE = 'Usage: pub-engine credentials set <id> [--account-id <value>] [--user-id <value>] | pub-engine credentials clear <id>'

export async function runCredentialsCommand(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args
  if (verb === 'set') {
    await runSet(rest)
    return
  }
  if (verb === 'clear') {
    await runClear(rest)
    return
  }
  fail(CREDENTIALS_USAGE)
}

async function runSet(args: readonly string[]): Promise<void> {
  // Drain stdin before rejecting so a Shell pipe is not left unread.
  const secret = (await readStdin()).trim()
  const parsed = parseSetArgs(args)
  if (typeof parsed === 'string') {
    fail(parsed)
    return
  }
  const provider = providerExtra(parsed.id)
  if (provider === undefined) {
    fail(`Unknown provider: ${parsed.id}`)
    return
  }
  const extra = validateExtra(parsed.id, provider, parsed.fields)
  if (typeof extra === 'string') {
    fail(extra)
    return
  }
  if (secret.length === 0) {
    fail('Secret is empty')
    return
  }
  const path = credentialsPath()
  const current = await readCredentialDocument(path)
  if (current === undefined) {
    fail('credentials.json is invalid')
    return
  }
  const entry: Record<string, string> = { token: secret }
  if (extra !== undefined)
    entry[extra.key] = extra.value
  await writePrivate(path, formatDocument({ ...current, [parsed.id]: entry }))
  process.stdout.write(acknowledge(parsed.id))
}

async function runClear(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || args[0] === undefined || args[0].length === 0 || args[0].startsWith('-')) {
    fail(CREDENTIALS_USAGE)
    return
  }
  const id = args[0]
  const path = credentialsPath()
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeErrno(error) && error.code === 'ENOENT') {
      process.stdout.write(acknowledge(id))
      return
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    fail('credentials.json is invalid')
    return
  }
  if (!isRecord(parsed)) {
    fail('credentials.json is invalid')
    return
  }
  if (!Object.hasOwn(parsed, id)) {
    process.stdout.write(acknowledge(id))
    return
  }
  const next = { ...parsed }
  delete next[id]
  await writePrivate(path, formatDocument(next))
  process.stdout.write(acknowledge(id))
}

interface ParsedSet {
  id: string
  fields: Map<string, string>
}

function parseSetArgs(args: readonly string[]): ParsedSet | string {
  const [id, ...rest] = args
  if (id === undefined || id.length === 0 || id.startsWith('-'))
    return CREDENTIALS_USAGE
  const known = knownFlags()
  const fields = new Map<string, string>()
  let index = 0
  while (index < rest.length) {
    const flag = rest[index]
    if (flag === undefined || !flag.startsWith('--'))
      return CREDENTIALS_USAGE
    if (!known.has(flag))
      return `Unknown flag: ${flag}`
    const value = rest[index + 1]
    if (value === undefined || value.startsWith('-'))
      return CREDENTIALS_USAGE
    if (fields.has(flag))
      return CREDENTIALS_USAGE
    fields.set(flag, value)
    index += 2
  }
  return { id, fields }
}

interface ProviderExtra {
  flag?: string
  key?: string
  required: boolean
}

function providerExtra(id: string): ProviderExtra | undefined {
  const entry = catalogEntries().find(row => row.id === id)
  if (entry === undefined)
    return undefined
  if (entry.extra === undefined)
    return { required: false }
  return {
    flag: flagFor(entry.extra.key),
    key: entry.extra.key,
    required: entry.extra.required,
  }
}

function validateExtra(
  id: string,
  provider: ProviderExtra,
  fields: Map<string, string>,
): { key: string, value: string } | undefined | string {
  let extra: { key: string, value: string } | undefined
  for (const [flag, value] of fields) {
    if (provider.flag === undefined || flag !== provider.flag || provider.key === undefined)
      return `${flag} is not valid for ${id}`
    const trimmed = value.trim()
    if (trimmed.length === 0)
      return provider.required ? `Missing required ${flag}` : `${flag} must not be blank`
    extra = { key: provider.key, value: trimmed }
  }
  if (provider.required && extra === undefined && provider.flag !== undefined)
    return `Missing required ${provider.flag}`
  return extra
}

function knownFlags(): Map<string, string> {
  const flags = new Map<string, string>()
  for (const entry of catalogEntries()) {
    if (entry.extra === undefined)
      continue
    flags.set(flagFor(entry.extra.key), entry.extra.key)
  }
  return flags
}

function flagFor(key: string): string {
  return `--${key.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`
}

function credentialsPath(): string {
  return join(pubConfigDir(defaultStore()), 'credentials.json')
}

async function readCredentialDocument(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch (error) {
    if (isNodeErrno(error) && error.code === 'ENOENT')
      return {}
    if (error instanceof SyntaxError)
      return undefined
    throw error
  }
}

function acknowledge(id: string): string {
  return `${JSON.stringify({ id }, null, 2)}\n`
}

function formatDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writePrivate(path: string, json: string): Promise<void> {
  await writeAtomic(path, json, 0o600)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function fail(message: string): void {
  console.error(message)
  process.exitCode = 1
}
