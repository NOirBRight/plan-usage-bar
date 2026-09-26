import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'src', 'cli.ts')

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(home: string, args: readonly string[]): Promise<RunResult> {
  return execFileAsync(process.execPath, ['--experimental-strip-types', cli, ...args], {
    cwd: root,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
    },
    encoding: 'utf8',
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: NodeJS.ErrnoException & { stdout?: string, stderr?: string }) => {
      if (typeof error.stdout !== 'string' && typeof error.stderr !== 'string')
        throw error
      return {
        code: typeof error.code === 'number' ? error.code : 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
      }
    },
  )
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'pub-catalog-'))
  try {
    await fn(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

interface CatalogCli {
  bin: string
  args: string[]
  file: string
  label: string
}

interface CatalogPage {
  url: string
  label: string
}

interface CatalogExtra {
  key: string
  hint: string
  required: boolean
}

interface CatalogCodeEntry {
  hint: string
  invalidPattern: string
  flags?: string
}

interface CatalogEntry {
  id: string
  name: string
  shortName: string
  icon: string
  accent: string
  usageUrl: string
  statusUrl: string
  credentialKind: 'cli' | 'key' | 'both'
  cli?: CatalogCli
  page?: CatalogPage
  hint: string
  extra?: CatalogExtra
  codeEntry?: CatalogCodeEntry
}

const EXPECTED: CatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude',
    shortName: 'Claude',
    icon: 'claude',
    accent: '#C96442',
    usageUrl: 'https://claude.ai/settings/usage',
    statusUrl: 'https://status.anthropic.com',
    credentialKind: 'cli',
    cli: {
      bin: 'claude',
      args: ['auth', 'login'],
      file: '~/.claude/.credentials.json',
      label: 'Claude Code',
    },
    hint: 'Claude access token',
    codeEntry: {
      hint: '粘贴浏览器页面上的授权码',
      invalidPattern: 'invalid code',
      flags: 'iu',
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    icon: 'codex',
    accent: '#10a37f',
    usageUrl: 'https://chatgpt.com/#settings',
    statusUrl: 'https://status.openai.com',
    credentialKind: 'cli',
    cli: {
      bin: 'codex',
      args: ['login'],
      file: '~/.codex/auth.json',
      label: 'Codex CLI',
    },
    hint: 'Codex access token',
    extra: { key: 'accountId', hint: 'Codex account ID', required: true },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    shortName: 'Cursor',
    icon: 'cursor',
    accent: '#111111',
    usageUrl: 'https://cursor.com/dashboard',
    statusUrl: 'https://status.cursor.com',
    credentialKind: 'cli',
    cli: {
      bin: 'cursor-agent',
      args: ['login'],
      file: '~/.config/cursor/auth.json',
      label: 'Cursor Agent',
    },
    page: { url: 'https://cursor.com/dashboard', label: 'cursor.com' },
    hint: 'WorkosCursorSessionToken 或 Cursor JWT',
    extra: { key: 'userId', hint: 'Cursor user ID（token 已含时留空）', required: false },
  },
  {
    id: 'grok',
    name: 'Grok',
    shortName: 'Grok',
    icon: 'grok',
    accent: '#111111',
    usageUrl: 'https://grok.com/?_s=usage',
    statusUrl: 'https://status.x.ai',
    credentialKind: 'cli',
    cli: {
      bin: 'grok',
      args: ['login', '--oauth'],
      file: '~/.grok/auth.json',
      label: 'Grok CLI',
    },
    hint: 'Grok API key / access token',
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    shortName: 'Ollama',
    icon: 'ollama-cloud',
    accent: '#111111',
    usageUrl: 'https://ollama.com',
    statusUrl: 'https://status.ollama.com',
    credentialKind: 'key',
    page: { url: 'https://ollama.com/settings/keys', label: 'ollama.com' },
    hint: 'Ollama API key',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    shortName: 'OpenCode',
    icon: 'opencode-go',
    accent: '#FF5C00',
    usageUrl: 'https://opencode.ai',
    statusUrl: 'https://opencode.ai',
    credentialKind: 'both',
    cli: {
      bin: 'opencode',
      args: ['auth', 'login'],
      file: '~/.local/share/opencode/auth.json',
      label: 'OpenCode Go',
    },
    page: { url: 'https://opencode.ai/auth', label: 'opencode.ai' },
    hint: 'OpenCode Go API key',
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    shortName: 'Cmd Code',
    icon: 'commandcode',
    accent: '#111111',
    usageUrl: 'https://commandcode.ai/usage',
    statusUrl: 'https://commandcode.ai/usage',
    credentialKind: 'both',
    cli: {
      bin: 'cmd',
      args: ['login'],
      file: '~/.commandcode/auth.json',
      label: 'Command Code',
    },
    page: { url: 'https://commandcode.ai/studio', label: 'commandcode.ai' },
    hint: 'Command Code API key',
  },
]

describe('pub-engine catalog', () => {
  it('prints every default Provider as pretty JSON and exits 0', async () => {
    await withHome(async home => {
      const result = await run(home, ['catalog'])
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      const catalog = JSON.parse(result.stdout) as CatalogEntry[]
      expect(result.stdout).toBe(`${JSON.stringify(catalog, null, 2)}\n`)
      expect(catalog).toEqual(EXPECTED)
      expect(catalog.map(entry => entry.id)).toEqual([
        'claude',
        'codex',
        'cursor',
        'grok',
        'ollama-cloud',
        'opencode-go',
        'commandcode',
      ])
    })
  })

  it('gives Claude a code entry the Shell can compile as /invalid code/iu', async () => {
    await withHome(async home => {
      const result = await run(home, ['catalog'])
      expect(result.code).toBe(0)
      const catalog = JSON.parse(result.stdout) as CatalogEntry[]
      const claude = catalog.find(entry => entry.id === 'claude')
      expect(claude?.codeEntry).toEqual({
        hint: '粘贴浏览器页面上的授权码',
        invalidPattern: 'invalid code',
        flags: 'iu',
      })
      expect(typeof claude?.codeEntry?.invalidPattern).toBe('string')
      const pattern = new RegExp(claude?.codeEntry?.invalidPattern ?? '', claude?.codeEntry?.flags ?? '')
      expect(String(pattern)).toBe('/invalid code/iu')
      expect(pattern.test('Error: invalid code')).toBe(true)
      expect(pattern.test('INVALID CODE')).toBe(true)
      expect(pattern.test('valid token')).toBe(false)
    })
  })

  it('requires Codex accountId and leaves Cursor userId optional', async () => {
    await withHome(async home => {
      const result = await run(home, ['catalog'])
      expect(result.code).toBe(0)
      const catalog = JSON.parse(result.stdout) as CatalogEntry[]
      expect(catalog.find(entry => entry.id === 'codex')?.extra).toEqual({
        key: 'accountId',
        hint: 'Codex account ID',
        required: true,
      })
      expect(catalog.find(entry => entry.id === 'cursor')?.extra).toEqual({
        key: 'userId',
        hint: 'Cursor user ID（token 已含时留空）',
        required: false,
      })
    })
  })

  it('lists page URLs for key Providers and CLI fallback only where a CLI exists', async () => {
    await withHome(async home => {
      const result = await run(home, ['catalog'])
      expect(result.code).toBe(0)
      const catalog = JSON.parse(result.stdout) as CatalogEntry[]
      const byId = new Map(catalog.map(entry => [entry.id, entry]))
      expect(byId.get('ollama-cloud')?.credentialKind).toBe('key')
      expect(byId.get('ollama-cloud')?.page).toEqual({
        url: 'https://ollama.com/settings/keys',
        label: 'ollama.com',
      })
      expect(byId.get('ollama-cloud')?.cli).toBeUndefined()
      expect(byId.get('opencode-go')?.credentialKind).toBe('both')
      expect(byId.get('opencode-go')?.page).toEqual({
        url: 'https://opencode.ai/auth',
        label: 'opencode.ai',
      })
      expect(byId.get('opencode-go')?.cli).toEqual({
        bin: 'opencode',
        args: ['auth', 'login'],
        file: '~/.local/share/opencode/auth.json',
        label: 'OpenCode Go',
      })
      expect(byId.get('commandcode')?.credentialKind).toBe('both')
      expect(byId.get('commandcode')?.page).toEqual({
        url: 'https://commandcode.ai/studio',
        label: 'commandcode.ai',
      })
      expect(byId.get('commandcode')?.cli).toEqual({
        bin: 'cmd',
        args: ['login'],
        file: '~/.commandcode/auth.json',
        label: 'Command Code',
      })
    })
  })
})
