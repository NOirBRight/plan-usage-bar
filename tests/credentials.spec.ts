import { describe, expect, it } from 'vitest'
import {
  parsePubCredentials,
  loadPubCredentials,
  renewGrokAccess,
  resolveAccess,
  type CredentialStore,
} from '../src/credentials.ts'
import { parseSettings, DEFAULT_SETTINGS } from '../src/snapshot.ts'

function cursorJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url')
  return `${header}.${payload}.sig`
}

function memoryStore(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): CredentialStore {
  return {
    home: '/home/user',
    env,
    run: async () => ({ code: 1, stdout: '' }),
    readFile: async (path: string) => {
      const value = files[path]
      if (value === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return value
    },
  }
}

describe('parsePubCredentials', () => {
  it('keeps only providers with a token and splits userId::token', () => {
    expect(parsePubCredentials({
      claude: { token: ' claude-token ', plan: 'pro' },
      cursor: { token: 'user_abc::cursor-token' },
      grok: { token: '' },
      ignored: { token: 1 },
    })).toEqual({
      claude: { token: 'claude-token', plan: 'pro' },
      cursor: { token: 'cursor-token', userId: 'user_abc' },
    })
  })

  it('takes Cursor userId from a JWT sub', () => {
    const token = cursorJwt('auth0|user_01ABC')
    expect(parsePubCredentials({
      cursor: { token: `WorkosCursorSessionToken=${token}` },
    })).toEqual({
      cursor: { token, userId: 'user_01ABC' },
    })
  })
})

describe('resolveAccess', () => {
  const dshFiles = {
    '/home/user/.dsh/cursor-oauth.json': JSON.stringify({
      accessToken: 'dsh-cursor',
      userId: 'dsh-user',
    }),
    '/home/user/.dsh/codex-oauth.json': JSON.stringify({
      credential: { access: 'dsh-codex', accountId: 'dsh-acct' },
    }),
    '/home/user/.dsh/grok-oauth.json': JSON.stringify({ accessToken: 'dsh-grok' }),
    '/home/user/.dsh/.credentials.yaml': 'OLLAMA_API_KEY: dsh-ollama\nOPENCODE_API_KEY: dsh-opencode\nCOMMANDCODE_API_KEY: dsh-cmd\n',
  }

  it('uses credentials.json when no CLI home exists', async () => {
    const store = memoryStore({
      ...dshFiles,
      '/home/user/.config/pub/credentials.json': JSON.stringify({
        claude: { token: 'pub-claude', plan: 'pro' },
        cursor: { token: 'pub-cursor', userId: 'pub-user' },
        'ollama-cloud': { token: 'pub-ollama' },
        'opencode-go': { token: 'pub-go' },
        commandcode: { token: 'pub-cmd' },
      }),
    })
    const pub = await loadPubCredentials(store, '/home/user/.config/pub')
    await expect(resolveAccess('claude', store, pub['claude'])).resolves.toEqual({
      token: 'pub-claude',
      plan: 'pro',
      source: 'pub',
    })
    await expect(resolveAccess('cursor', store, pub['cursor'])).resolves.toEqual({
      token: 'pub-cursor',
      userId: 'pub-user',
      source: 'pub',
    })
    await expect(resolveAccess('ollama-cloud', store, pub['ollama-cloud'])).resolves.toEqual({
      token: 'pub-ollama',
      source: 'pub',
    })
    await expect(resolveAccess('opencode-go', store, pub['opencode-go'])).resolves.toEqual({
      token: 'pub-go',
      source: 'pub',
    })
    await expect(resolveAccess('commandcode', store, pub['commandcode'])).resolves.toEqual({
      token: 'pub-cmd',
      source: 'pub',
    })
  })

  it('does not read DSH files', async () => {
    const store = memoryStore(dshFiles)
    await expect(resolveAccess('codex', store)).resolves.toBeUndefined()
    await expect(resolveAccess('cursor', store)).resolves.toBeUndefined()
    await expect(resolveAccess('grok', store)).resolves.toBeUndefined()
    await expect(resolveAccess('ollama-cloud', store)).resolves.toBeUndefined()
    await expect(resolveAccess('opencode-go', store)).resolves.toBeUndefined()
    await expect(resolveAccess('commandcode', store)).resolves.toBeUndefined()
  })

  it('falls back to official CLI homes', async () => {
    const store = memoryStore({
      '/home/user/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'cli-claude', subscriptionType: 'pro' },
      }),
      '/home/user/.codex/auth.json': JSON.stringify({
        tokens: { access_token: 'cli-codex', account_id: 'cli-acct' },
      }),
      '/home/user/.grok/auth.json': JSON.stringify({
        'https://auth.x.ai::id': { key: 'cli-grok' },
      }),
    })
    await expect(resolveAccess('claude', store)).resolves.toEqual({ token: 'cli-claude', plan: 'pro', source: 'cli' })
    await expect(resolveAccess('codex', store)).resolves.toEqual({ token: 'cli-codex', accountId: 'cli-acct', source: 'cli' })
    await expect(resolveAccess('grok', store)).resolves.toEqual({ token: 'cli-grok', source: 'cli' })
  })

  it('reads Claude and Codex from official directory variables', async () => {
    const store = memoryStore({
      '/opt/claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'moved-claude' },
      }),
      '/opt/codex/auth.json': JSON.stringify({
        tokens: { access_token: 'moved-codex', account_id: 'moved-acct' },
      }),
    }, { CLAUDE_CONFIG_DIR: '/opt/claude', CODEX_HOME: '/opt/codex' })
    await expect(resolveAccess('claude', store)).resolves.toEqual({ token: 'moved-claude', source: 'cli' })
    await expect(resolveAccess('codex', store)).resolves.toEqual({
      token: 'moved-codex',
      accountId: 'moved-acct',
      source: 'cli',
    })
  })

  it('does not mix an incomplete PUB Codex credential with the CLI Account', async () => {
    const store = memoryStore({
      '/home/user/.codex/auth.json': JSON.stringify({
        tokens: { access_token: 'cli-codex', account_id: 'cli-acct' },
      }),
    })
    await expect(resolveAccess('codex', store, { token: 'pub-codex' })).resolves.toBeUndefined()
  })

  it('does not resolve Cursor without a userId', async () => {
    const store = memoryStore({})
    await expect(resolveAccess('cursor', store, { token: 'cursor-token' })).resolves.toBeUndefined()
  })

  it('falls back to cursor-agent auth.json', async () => {
    const token = cursorJwt('auth0|user_01CLI')
    const store = memoryStore({
      '/home/user/.config/cursor/auth.json': JSON.stringify({ accessToken: token, refreshToken: 'refresh' }),
    })
    await expect(resolveAccess('cursor', store)).resolves.toEqual({
      token,
      userId: 'user_01CLI',
      source: 'cli',
    })
  })

  it('reads Cursor auth.json from XDG_CONFIG_HOME', async () => {
    const token = cursorJwt('user_01XDG')
    const store = memoryStore({
      '/opt/cursor-xdg/cursor/auth.json': JSON.stringify({ accessToken: token }),
    }, { XDG_CONFIG_HOME: '/opt/cursor-xdg' })
    await expect(resolveAccess('cursor', store)).resolves.toEqual({
      token,
      userId: 'user_01XDG',
      source: 'cli',
    })
  })

  it('does not mix an incomplete PUB Cursor credential with cursor-agent', async () => {
    const token = cursorJwt('auth0|user_01CLI')
    const store = memoryStore({
      '/home/user/.config/cursor/auth.json': JSON.stringify({ accessToken: token }),
    })
    await expect(resolveAccess('cursor', store, { token: 'opaque-cookie' })).resolves.toBeUndefined()
  })

  it('labels OLLAMA_API_KEY as env', async () => {
    const store = memoryStore({}, { OLLAMA_API_KEY: 'env-ollama' })
    await expect(resolveAccess('ollama-cloud', store)).resolves.toEqual({ token: 'env-ollama', source: 'env' })
  })

  it('falls back to OpenCode Go CLI auth.json then env aliases', async () => {
    const cli = memoryStore({
      '/home/user/.local/share/opencode/auth.json': JSON.stringify({
        'opencode-go': { type: 'api', key: 'cli-go' },
        opencode: { type: 'api', key: 'zen-key' },
      }),
    }, { OPENCODE_API_KEY: 'env-go' })
    await expect(resolveAccess('opencode-go', cli)).resolves.toEqual({ token: 'cli-go', source: 'cli' })
    const xdg = memoryStore({
      '/opt/data/opencode/auth.json': JSON.stringify({
        'opencode-go': { key: 'xdg-go' },
      }),
    }, { XDG_DATA_HOME: '/opt/data' })
    await expect(resolveAccess('opencode-go', xdg)).resolves.toEqual({ token: 'xdg-go', source: 'cli' })
    const env = memoryStore({}, { OPENCODE_GO_API_KEY: 'alias-go' })
    await expect(resolveAccess('opencode-go', env)).resolves.toEqual({ token: 'alias-go', source: 'env' })
    const zenOnly = memoryStore({
      '/home/user/.local/share/opencode/auth.json': JSON.stringify({
        opencode: { type: 'api', key: 'zen-key' },
      }),
    })
    await expect(resolveAccess('opencode-go', zenOnly)).resolves.toBeUndefined()
  })

  it('prefers the active OpenCode 2 credential over a stale auth.json key', async () => {
    const store: CredentialStore = {
      ...memoryStore({
        '/home/user/.local/share/opencode/auth.json': JSON.stringify({
          'opencode-go': { type: 'api', key: 'stale-go' },
        }),
      }),
      run: async command => {
        expect(command).toEqual(['opencode', 'auth', 'export', 'opencode-go'])
        return {
          code: 0,
          stdout: JSON.stringify([
            { id: 'cred_old', integrationID: 'opencode-go', active: false, value: { type: 'key', key: 'old-go' } },
            { id: 'cred_new', integrationID: 'opencode-go', active: true, value: { type: 'key', key: 'db-go' } },
            { id: 'cred_none', integrationID: 'opencode-go', value: { type: 'key', key: 'no-active-go' } },
          ]),
        }
      },
    }
    await expect(resolveAccess('opencode-go', store)).resolves.toEqual({ token: 'db-go', source: 'cli' })
  })

  it('falls back to OpenCode auth.json when the credential export fails', async () => {
    const store: CredentialStore = {
      ...memoryStore({
        '/home/user/.local/share/opencode/auth.json': JSON.stringify({
          'opencode-go': { type: 'api', key: 'cli-go' },
        }),
      }),
      run: async () => ({ code: 1, stdout: '' }),
    }
    await expect(resolveAccess('opencode-go', store)).resolves.toEqual({ token: 'cli-go', source: 'cli' })
  })

  it('falls back to Command Code CLI apiKey then env aliases and ignores BYOK keys', async () => {
    const cli = memoryStore({
      '/home/user/.commandcode/auth.json': JSON.stringify({
        apiKey: 'cli-cmd',
        anthropic: { apiKey: 'byok' },
      }),
    }, { COMMAND_CODE_API_KEY: 'env-cmd' })
    await expect(resolveAccess('commandcode', cli)).resolves.toEqual({ token: 'cli-cmd', source: 'cli' })
    const byokOnly = memoryStore({
      '/home/user/.commandcode/auth.json': JSON.stringify({
        anthropic: { apiKey: 'byok' },
      }),
    })
    await expect(resolveAccess('commandcode', byokOnly)).resolves.toBeUndefined()
    const official = memoryStore({}, { COMMAND_CODE_API_KEY: 'official-cmd' })
    await expect(resolveAccess('commandcode', official)).resolves.toEqual({ token: 'official-cmd', source: 'env' })
    const alias = memoryStore({}, { COMMANDCODE_API_KEY: 'alias-cmd' })
    await expect(resolveAccess('commandcode', alias)).resolves.toEqual({ token: 'alias-cmd', source: 'env' })
  })
})

describe('parseSettings', () => {
  it('keeps a chosen Primary Window and appends missing defaults', () => {
    const settings = parseSettings({
      remainingMode: false,
      providers: [
        { id: 'codex', enabled: true, pinned: true, primary: 'spark-5-hour' },
        { id: 'cursor', enabled: true, pinned: false, primary: '' },
      ],
    })
    expect(settings.remainingMode).toBe(false)
    expect(settings.providers).toEqual([
      { id: 'codex', enabled: true, pinned: true, primary: 'spark-5-hour' },
      { id: 'cursor', enabled: true, pinned: false },
      { id: 'claude', enabled: true, pinned: true },
      { id: 'grok', enabled: true, pinned: true },
      { id: 'ollama-cloud', enabled: true, pinned: false },
      { id: 'opencode-go', enabled: true, pinned: false },
      { id: 'commandcode', enabled: true, pinned: false },
    ])
  })

  it('keeps unknown ids, drops duplicates, and treats an empty list as defaults', () => {
    expect(parseSettings({
      remainingMode: true,
      providers: [
        { id: 'claude', enabled: false, pinned: false },
        { id: 'claude', enabled: true, pinned: true },
        { id: 'future', enabled: true, pinned: true },
      ],
    }).providers.map(row => row.id)).toEqual([
      'claude', 'future', 'codex', 'cursor', 'grok', 'ollama-cloud', 'opencode-go', 'commandcode',
    ])
    expect(parseSettings({ providers: [] })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('Grok credentials', () => {
  const authPath = '/home/user/.grok/auth.json'
  const versionPath = '/home/user/.grok/version.json'

  function grokStore(
    files: Record<string, string>,
    renew?: (files: Record<string, string>) => void,
    env: NodeJS.ProcessEnv = {},
  ) {
    const state = { ...files }
    const commands: string[][] = []
    const store: CredentialStore = {
      home: '/home/user',
      env,
      run: async (command: readonly string[]) => {
        commands.push([...command])
        renew?.(state)
        return { code: 0, stdout: '' }
      },
      readFile: async (path: string) => {
        const value = state[path]
        if (value === undefined) {
          const error = new Error('ENOENT') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        return value
      },
    }
    return { store, state, commands }
  }

  it('resolves the newest login without spawning the CLI', async () => {
    const old = new Date(Date.now() - 60_000).toISOString()
    const fresh = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { store, commands } = grokStore({
      [authPath]: JSON.stringify({
        'https://auth.x.ai::old': { key: 'old', expires_at: old },
        'https://auth.x.ai::new': { key: 'new', expires_at: fresh },
      }),
    })
    await expect(resolveAccess('grok', store)).resolves.toEqual({ token: 'new', source: 'cli' })
    expect(commands).toEqual([])
  })

  it('reports the CLI version recorded beside auth.json', async () => {
    const { store } = grokStore({
      [authPath]: JSON.stringify({ 'https://auth.x.ai::client': { key: 'live' } }),
      [versionPath]: JSON.stringify({ version: '1.0.71' }),
    })
    await expect(resolveAccess('grok', store)).resolves.toEqual({
      token: 'live',
      source: 'cli',
      clientVersion: '1.0.71',
    })
  })

  it('lets the CLI renew the token and reads what it wrote', async () => {
    const { store, state, commands } = grokStore({
      [authPath]: JSON.stringify({ 'https://auth.x.ai::client': { key: 'stale' } }),
    }, files => {
      files[authPath] = JSON.stringify({ 'https://auth.x.ai::client': { key: 'fresh' } })
    })
    await expect(renewGrokAccess(store)).resolves.toEqual({ token: 'fresh', source: 'cli' })
    expect(commands).toEqual([['grok', 'models']])
    expect(state[authPath]).toContain('fresh')
  })

  it('keeps the stored token when the CLI cannot renew it', async () => {
    const { store } = grokStore({
      [authPath]: JSON.stringify({ 'https://auth.x.ai::client': { key: 'stale' } }),
    })
    await expect(renewGrokAccess(store)).resolves.toEqual({ token: 'stale', source: 'cli' })
  })

  it('reads auth.json and version.json from GROK_HOME', async () => {
    const { store } = grokStore({
      '/opt/grok/auth.json': JSON.stringify({ 'https://auth.x.ai::client': { key: 'home-token' } }),
      '/opt/grok/version.json': JSON.stringify({ version: '1.0.72' }),
    }, undefined, { GROK_HOME: '/opt/grok' })
    await expect(resolveAccess('grok', store)).resolves.toEqual({
      token: 'home-token',
      source: 'cli',
      clientVersion: '1.0.72',
    })
  })
})
