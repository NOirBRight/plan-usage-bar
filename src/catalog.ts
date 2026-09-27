import { ADAPTERS } from './providers/registry.ts'
import { DEFAULT_SETTINGS, shortNameFor, type ProviderIdentity } from './snapshot.ts'

export type CredentialKind = 'cli' | 'key' | 'both'

export interface CatalogCli {
  bin: string
  args: string[]
  file: string
  label: string
}

export interface CatalogPage {
  url: string
  label: string
}

export interface CatalogExtra {
  key: string
  hint: string
  required: boolean
}

/** `flags` is passed to `new RegExp(invalidPattern, flags)`, so Claude stays `/invalid code/iu`. */
export interface CatalogCodeEntry {
  hint: string
  invalidPattern: string
  flags: string
}

export interface CatalogEntry {
  id: string
  name: string
  shortName: string
  icon: string
  accent: string
  usageUrl: string
  statusUrl: string
  credentialKind: CredentialKind
  cli?: CatalogCli
  page?: CatalogPage
  hint: string
  extra?: CatalogExtra
  codeEntry?: CatalogCodeEntry
}

interface LoginFacts {
  credentialKind: CredentialKind
  hint: string
  cli?: CatalogCli
  page?: CatalogPage
  extra?: CatalogExtra
  codeEntry?: CatalogCodeEntry
}

const LOGIN: Record<string, LoginFacts> = {
  claude: {
    credentialKind: 'cli',
    hint: 'Claude access token',
    cli: {
      bin: 'claude',
      args: ['auth', 'login'],
      file: '~/.claude/.credentials.json',
      label: 'Claude Code',
    },
    // claude.ai shows code#state when there is no localhost callback; the CLI reads that line from stdin.
    codeEntry: {
      hint: '粘贴浏览器页面上的授权码',
      invalidPattern: 'invalid code',
      flags: 'iu',
    },
  },
  codex: {
    credentialKind: 'cli',
    hint: 'Codex access token',
    cli: {
      bin: 'codex',
      args: ['login'],
      file: '~/.codex/auth.json',
      label: 'Codex CLI',
    },
    extra: { key: 'accountId', hint: 'Codex account ID', required: true },
  },
  grok: {
    credentialKind: 'cli',
    hint: 'Grok API key / access token',
    cli: {
      bin: 'grok',
      args: ['login', '--oauth'],
      file: '~/.grok/auth.json',
      label: 'Grok CLI',
    },
  },
  cursor: {
    credentialKind: 'cli',
    hint: 'WorkosCursorSessionToken 或 Cursor JWT',
    cli: {
      bin: 'cursor-agent',
      args: ['login'],
      file: '~/.config/cursor/auth.json',
      label: 'Cursor Agent',
    },
    page: { url: 'https://cursor.com/dashboard', label: 'cursor.com' },
    extra: { key: 'userId', hint: 'Cursor user ID（token 已含时留空）', required: false },
  },
  'ollama-cloud': {
    credentialKind: 'key',
    hint: 'Ollama API key',
    page: { url: 'https://ollama.com/settings/keys', label: 'ollama.com' },
  },
  'opencode-go': {
    credentialKind: 'both',
    hint: 'OpenCode Go API key',
    cli: {
      bin: 'opencode',
      args: ['auth', 'login'],
      file: '~/.local/share/opencode/auth.json',
      label: 'OpenCode Go',
    },
    page: { url: 'https://opencode.ai/auth', label: 'opencode.ai' },
  },
  commandcode: {
    credentialKind: 'both',
    hint: 'Command Code API key',
    cli: {
      bin: 'cmd',
      args: ['login'],
      file: '~/.commandcode/auth.json',
      label: 'Command Code',
    },
    page: { url: 'https://commandcode.ai/studio', label: 'commandcode.ai' },
  },
}

export function catalogEntries(): CatalogEntry[] {
  return DEFAULT_SETTINGS.providers.map(row => {
    const adapter = ADAPTERS[row.id]
    const facts = LOGIN[row.id]
    if (adapter === undefined || facts === undefined)
      throw new Error(`No catalog entry for ${row.id}`)
    return catalogEntry(adapter.identity, facts)
  })
}

function catalogEntry(identity: ProviderIdentity, facts: LoginFacts): CatalogEntry {
  return {
    id: identity.id,
    name: identity.name,
    shortName: shortNameFor(identity.name),
    icon: identity.id,
    accent: identity.accent,
    usageUrl: identity.usageUrl,
    statusUrl: identity.statusUrl,
    credentialKind: facts.credentialKind,
    ...facts.cli === undefined ? {} : {
      cli: {
        bin: facts.cli.bin,
        args: [...facts.cli.args],
        file: facts.cli.file,
        label: facts.cli.label,
      },
    },
    ...facts.page === undefined ? {} : {
      page: { url: facts.page.url, label: facts.page.label },
    },
    hint: facts.hint,
    ...facts.extra === undefined ? {} : {
      extra: {
        key: facts.extra.key,
        hint: facts.extra.hint,
        required: facts.extra.required,
      },
    },
    ...facts.codeEntry === undefined ? {} : {
      codeEntry: {
        hint: facts.codeEntry.hint,
        invalidPattern: facts.codeEntry.invalidPattern,
        flags: facts.codeEntry.flags,
      },
    },
  }
}

export function runCatalogCommand(): void {
  process.stdout.write(`${JSON.stringify(catalogEntries(), null, 2)}\n`)
}
