import { join } from 'node:path'
import { writeAtomic } from './atomic-write.ts'
import { defaultStore, pubConfigDir, readOptional } from './credentials.ts'
import { loadSettings } from './engine.ts'
import { DEFAULT_SETTINGS, parseSettings, type ProviderSettings, type PubSettings } from './snapshot.ts'

const SETTINGS_USAGE = 'Usage: pub-engine settings | pub-engine settings set remaining-mode <true|false> | enabled <id> <true|false> | pinned <id> <true|false> | primary <id> <windowId> | primary <id> --clear | order <id> [<id>...]'

const KNOWN_PROVIDERS = DEFAULT_SETTINGS.providers.map(row => row.id)

/**
 * Quota Window ids the adapters emit as fixed strings.
 * Codex ids are the span (`5-hour`, `weekly`, `<n>-day`, `<n>-hour`) plus an optional limit-name prefix (`spark-5-hour`).
 */
const FIXED_WINDOWS: Record<string, readonly string[]> = {
  claude: ['session', 'weekly', 'weekly_all'],
  cursor: ['cursor-models', 'other-models', 'total'],
  grok: ['weekly'],
  'ollama-cloud': ['session', 'weekly', 'monthly'],
  'opencode-go': ['session', 'weekly', 'monthly'],
  commandcode: ['session', 'weekly', 'monthly'],
}

const CODEX_SPAN = '(?:5-hour|weekly|\\d+-day|\\d+-hour)'
const CODEX_WINDOW = new RegExp(`^(?:${CODEX_SPAN}|.+-${CODEX_SPAN})$`, 'u')

type Mutation =
  | { kind: 'remaining-mode', value: boolean }
  | { kind: 'enabled', id: string, value: boolean }
  | { kind: 'pinned', id: string, value: boolean }
  | { kind: 'primary', id: string, windowId: string }
  | { kind: 'clear-primary', id: string }
  | { kind: 'order', ids: string[] }

export async function runSettingsCommand(args: readonly string[]): Promise<void> {
  const store = defaultStore()
  const configDir = pubConfigDir(store)
  if (args.length === 0) {
    process.stdout.write(formatSettings(await loadSettings(store, configDir)))
    return
  }
  if (args[0] !== 'set') {
    console.error(SETTINGS_USAGE)
    process.exitCode = 1
    return
  }
  const mutation = parseMutation(args.slice(1))
  if (mutation === undefined) {
    console.error(SETTINGS_USAGE)
    process.exitCode = 1
    return
  }
  // A hand-edit typo must not be replaced by defaults plus one change.
  const text = await readOptional(store, join(configDir, 'settings.json'))
  let parsed: unknown
  try {
    parsed = text === undefined ? undefined : JSON.parse(text) as unknown
  } catch {
    parsed = null
  }
  if (text !== undefined && !settingsShape(parsed)) {
    console.error('settings.json is invalid')
    process.exitCode = 1
    return
  }
  const current = parseSettings(parsed)
  const next = applyMutation(current, mutation)
  if (typeof next === 'string') {
    console.error(next)
    process.exitCode = 1
    return
  }
  const json = formatSettings(next)
  await writeSettings(join(configDir, 'settings.json'), json)
  process.stdout.write(json)
}

// An object whose providers, if present, is an array. Anything else would merge to defaults.
function settingsShape(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const providers = (value as { providers?: unknown }).providers
  return providers === undefined || Array.isArray(providers)
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function parseMutation(args: readonly string[]): Mutation | undefined {
  const [verb, ...rest] = args
  if (verb === 'remaining-mode' && rest.length === 1) {
    const value = parseBool(rest[0])
    return value === undefined ? undefined : { kind: 'remaining-mode', value }
  }
  if ((verb === 'enabled' || verb === 'pinned') && rest.length === 2) {
    const id = rest[0]
    const value = parseBool(rest[1])
    if (id === undefined || id.length === 0 || value === undefined) return undefined
    return { kind: verb, id, value }
  }
  if (verb === 'primary' && rest.length === 2) {
    const id = rest[0]
    const windowId = rest[1]
    if (id === undefined || id.length === 0 || windowId === undefined || windowId.length === 0)
      return undefined
    if (windowId === '--clear') return { kind: 'clear-primary', id }
    if (windowId.startsWith('-')) return undefined
    return { kind: 'primary', id, windowId }
  }
  if (verb === 'order' && rest.length > 0 && rest.every(id => id.length > 0))
    return { kind: 'order', ids: [...rest] }
  return undefined
}

function applyMutation(settings: PubSettings, mutation: Mutation): PubSettings | string {
  if (mutation.kind === 'remaining-mode')
    return { remainingMode: mutation.value, providers: settings.providers }
  if (mutation.kind === 'order')
    return reorder(settings, mutation.ids)
  const unknown = unknownProvider(mutation.id)
  if (unknown !== undefined) return unknown
  if (mutation.kind === 'primary' && !isKnownWindow(mutation.id, mutation.windowId))
    return `Unknown quota window: ${mutation.windowId}`
  return {
    remainingMode: settings.remainingMode,
    providers: settings.providers.map(row => row.id === mutation.id ? updateRow(row, mutation) : row),
  }
}

function unknownProvider(id: string): string | undefined {
  return KNOWN_PROVIDERS.includes(id) ? undefined : `Unknown provider: ${id}`
}

function updateRow(row: ProviderSettings, mutation: Mutation): ProviderSettings {
  if (mutation.kind === 'enabled') {
    return {
      id: row.id,
      enabled: mutation.value,
      pinned: mutation.value ? row.pinned : false,
      ...row.primary === undefined ? {} : { primary: row.primary },
    }
  }
  if (mutation.kind === 'pinned') {
    return {
      id: row.id,
      enabled: row.enabled,
      pinned: mutation.value,
      ...row.primary === undefined ? {} : { primary: row.primary },
    }
  }
  if (mutation.kind === 'clear-primary')
    return { id: row.id, enabled: row.enabled, pinned: row.pinned }
  if (mutation.kind === 'primary') {
    return { id: row.id, enabled: row.enabled, pinned: row.pinned, primary: mutation.windowId }
  }
  return row
}

function reorder(settings: PubSettings, ids: readonly string[]): PubSettings | string {
  const seen = new Set<string>()
  for (const id of ids) {
    if (!KNOWN_PROVIDERS.includes(id)) return `Unknown provider: ${id}`
    if (seen.has(id)) return 'Order must list every known provider exactly once'
    seen.add(id)
  }
  if (seen.size !== KNOWN_PROVIDERS.length)
    return 'Order must list every known provider exactly once'
  const known = new Set(KNOWN_PROVIDERS)
  const byId = new Map(settings.providers.filter(row => known.has(row.id)).map(row => [row.id, row]))
  const ordered: ProviderSettings[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (row === undefined) return 'Order must list every known provider exactly once'
    ordered.push(row)
  }
  const extras = settings.providers.filter(row => !known.has(row.id))
  return { remainingMode: settings.remainingMode, providers: [...ordered, ...extras] }
}

// Claude kinds and Ollama limit keys are whatever the API sends. Other providers stay on the fixed list.
const WINDOW_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u
const DYNAMIC_PROVIDERS = new Set(['claude', 'ollama-cloud'])

function isKnownWindow(providerId: string, windowId: string): boolean {
  if (providerId === 'codex') return CODEX_WINDOW.test(windowId)
  if (FIXED_WINDOWS[providerId]?.includes(windowId)) return true
  return DYNAMIC_PROVIDERS.has(providerId) && WINDOW_SLUG.test(windowId)
}

function formatSettings(settings: PubSettings): string {
  return `${JSON.stringify({
    remainingMode: settings.remainingMode,
    providers: settings.providers.map(row => ({
      id: row.id,
      enabled: row.enabled,
      pinned: row.pinned,
      ...row.primary === undefined ? {} : { primary: row.primary },
    })),
  }, null, 2)}\n`
}

async function writeSettings(path: string, json: string): Promise<void> {
  await writeAtomic(path, json)
}
