import { describe, expect, it } from 'vitest'
import {
  parseSettings,
  loadPubCredentials,
  parsePubCredentials,
  readClaudeAccess,
  readCodexAccess,
  readCursorAccess,
  readGrokAccess,
  readOllamaKey,
  type CredentialStore,
} from '../src/credentials.ts'

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
  it('keeps only providers with a token', () => {
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

describe('PUB credentials beat CLI and ignore DSH', () => {
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
    await expect(readClaudeAccess(store, pub['claude'])).resolves.toEqual({
      token: 'pub-claude',
      plan: 'pro',
      source: 'pub',
    })
    await expect(readCursorAccess(store, pub['cursor'])).resolves.toEqual({
      token: 'pub-cursor',
      userId: 'pub-user',
      source: 'pub',
    })
    await expect(readOllamaKey(store, pub['ollama-cloud'])).resolves.toEqual({
      token: 'pub-ollama',
      source: 'pub',
    })
  })

  it('does not read DSH files', async () => {
    const store = memoryStore(dshFiles)
    await expect(readCodexAccess(store)).resolves.toBeUndefined()
    await expect(readCursorAccess(store)).resolves.toBeUndefined()
    await expect(readGrokAccess(store)).resolves.toBeUndefined()
    await expect(readOllamaKey(store)).resolves.toBeUndefined()
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
    await expect(readClaudeAccess(store)).resolves.toEqual({ token: 'cli-claude', plan: 'pro', source: 'cli' })
    await expect(readCodexAccess(store)).resolves.toEqual({ token: 'cli-codex', accountId: 'cli-acct', source: 'cli' })
    await expect(readGrokAccess(store)).resolves.toEqual({ token: 'cli-grok', source: 'cli' })
  })
})

describe('parseSettings', () => {
  it('keeps a chosen Primary Window and drops empty ones', () => {
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
    ])
  })
})
