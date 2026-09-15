import { describe, expect, it } from 'vitest'
import {
  parsePubCredentials,
  loadPubCredentials,
  resolveAccess,
  type CredentialStore,
} from '../src/credentials.ts'
import { parseSettings, DEFAULT_SETTINGS } from '../src/snapshot.ts'

function memoryStore(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): CredentialStore {
  return {
    home: '/home/user',
    env,
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
    '/home/user/.dsh/.credentials.yaml': 'OLLAMA_API_KEY: dsh-ollama\n',
  }

  it('uses credentials.json when no CLI home exists', async () => {
    const store = memoryStore({
      ...dshFiles,
      '/home/user/.config/pub/credentials.json': JSON.stringify({
        claude: { token: 'pub-claude', plan: 'pro' },
        cursor: { token: 'pub-cursor', userId: 'pub-user' },
        'ollama-cloud': { token: 'pub-ollama' },
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
  })

  it('does not read DSH files', async () => {
    const store = memoryStore(dshFiles)
    await expect(resolveAccess('codex', store)).resolves.toBeUndefined()
    await expect(resolveAccess('cursor', store)).resolves.toBeUndefined()
    await expect(resolveAccess('grok', store)).resolves.toBeUndefined()
    await expect(resolveAccess('ollama-cloud', store)).resolves.toBeUndefined()
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

  it('labels OLLAMA_API_KEY as env', async () => {
    const store = memoryStore({}, { OLLAMA_API_KEY: 'env-ollama' })
    await expect(resolveAccess('ollama-cloud', store)).resolves.toEqual({ token: 'env-ollama', source: 'env' })
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
      'claude', 'future', 'codex', 'cursor', 'grok', 'ollama-cloud',
    ])
    expect(parseSettings({ providers: [] })).toEqual(DEFAULT_SETTINGS)
  })
})
