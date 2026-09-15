import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/snapshot.ts'
import { applyPrimary, readSnapshot } from '../src/engine.ts'
import type { CredentialStore } from '../src/credentials.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function jsonResponse(name: string): Response {
  const body = readFileSync(join(fixtures, name), 'utf8')
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

function memoryStore(files: Record<string, string>): CredentialStore {
  return {
    home: '/home/user',
    env: {},
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

const previousClaude = {
  fetchedAt: '2026-09-14T00:00:00.000Z',
  remainingMode: true,
  providers: [{
    id: 'claude',
    name: 'Claude',
    plan: 'Pro',
    pinned: true,
    remaining: 0.98,
    accent: '#C96442',
    fetchedAt: '2026-09-14T00:00:00.000Z',
    usageUrl: 'https://claude.ai/settings/usage',
    statusUrl: 'https://status.anthropic.com',
    credentialSource: 'cli' as const,
    windows: [{
      id: 'weekly_all',
      label: 'Weekly',
      remaining: 0.98,
      resetLabel: 'Resets in 4d',
      primary: true,
    }],
  }],
}

describe('readSnapshot', () => {
  it('assembles Enabled providers from injected replies', async () => {
    const store = memoryStore({
      '/home/user/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'claude-token', subscriptionType: 'pro' },
      }),
      '/home/user/.codex/auth.json': JSON.stringify({
        tokens: { access_token: 'codex-token', account_id: 'acct' },
      }),
      '/home/user/.config/pub/credentials.json': JSON.stringify({
        cursor: { token: 'cursor-token', userId: 'user_abc' },
        'ollama-cloud': { token: 'ollama-key' },
        'opencode-go': { token: 'go-key' },
        commandcode: { token: 'cmd-key' },
      }),
      '/home/user/.grok/auth.json': JSON.stringify({
        'https://auth.x.ai::id': { key: 'grok-token' },
      }),
    })
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url)
      if (href.includes('api.anthropic.com')) return jsonResponse('claude-pro.json')
      if (href.includes('chatgpt.com')) return jsonResponse('codex-pro.json')
      if (href.includes('cursor.com')) return jsonResponse('cursor-ultra.json')
      if (href.includes('billing?format=credits')) return jsonResponse('grok-heavy.json')
      if (href.includes('/v1/settings')) {
        return new Response(JSON.stringify({ subscription_tier_display: 'SuperGrok Heavy' }), { status: 200 })
      }
      if (href.includes('ollama.com')) return jsonResponse('ollama-monthly.json')
      if (href.includes('opencode.ai/zen/go/v1/usage')) return jsonResponse('opencode-go.json')
      if (href.includes('api.commandcode.ai/alpha/whoami')) return jsonResponse('commandcode-whoami.json')
      if (href.includes('api.commandcode.ai/alpha/billing/credits')) return jsonResponse('commandcode-credits.json')
      if (href.includes('api.commandcode.ai/alpha/billing/subscriptions')) return jsonResponse('commandcode-subscription.json')
      if (href.includes('api.commandcode.ai/alpha/usage/summary')) return jsonResponse('commandcode-summary.json')
      return new Response('no', { status: 404 })
    }
    const snapshot = await readSnapshot({
      settings: DEFAULT_SETTINGS,
      store,
      fetch: fetchImpl,
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
    })
    expect(snapshot.providers.map(provider => provider.id)).toEqual([
      'claude', 'codex', 'cursor', 'grok', 'ollama-cloud', 'opencode-go', 'commandcode',
    ])
    expect(snapshot.providers.find(provider => provider.id === 'claude')?.remaining).toBe(0.98)
    expect(snapshot.providers.find(provider => provider.id === 'grok')?.remaining).toBe(0.99)
    expect(snapshot.providers.find(provider => provider.id === 'grok')?.plan).toBe('SuperGrok Heavy')
    expect(snapshot.providers.find(provider => provider.id === 'ollama-cloud')?.pinned).toBe(false)
    expect(snapshot.providers.find(provider => provider.id === 'opencode-go')?.pinned).toBe(false)
    expect(snapshot.providers.find(provider => provider.id === 'commandcode')?.pinned).toBe(false)
    expect(snapshot.providers.find(provider => provider.id === 'opencode-go')?.remaining).toBe(0.99)
    expect(snapshot.providers.find(provider => provider.id === 'commandcode')?.remaining).toBeCloseTo(4.73 / 70, 5)
    expect(snapshot.providers.find(provider => provider.id === 'cursor')?.credentialSource).toBe('pub')
    expect(snapshot.providers.find(provider => provider.id === 'claude')?.credentialSource).toBe('cli')
    expect(JSON.stringify(snapshot)).not.toMatch(/claude-token|codex-token|cursor-token|grok-token|ollama-key|go-key|cmd-key/u)
  })

  it('marks a provider signed out when no credential is present', async () => {
    const store = memoryStore({})
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [{ id: 'claude', enabled: true, pinned: true }],
      },
      store,
      fetch: async () => new Response('no', { status: 500 }),
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
    })
    expect(snapshot.providers).toEqual([expect.objectContaining({
      id: 'claude',
      remaining: null,
      error: 'signed out',
      errorKind: 'signed-out',
      windows: [],
    })])
  })

  it('keeps Enabled provider order from settings', async () => {
    const store = memoryStore({
      '/home/user/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'claude-token', subscriptionType: 'pro' },
      }),
      '/home/user/.grok/auth.json': JSON.stringify({
        'https://auth.x.ai::id': { key: 'grok-token' },
      }),
    })
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url)
      if (href.includes('api.anthropic.com')) return jsonResponse('claude-pro.json')
      if (href.includes('billing?format=credits')) return jsonResponse('grok-heavy.json')
      if (href.includes('/v1/settings')) {
        return new Response(JSON.stringify({ subscription_tier_display: 'SuperGrok Heavy' }), { status: 200 })
      }
      return new Response('no', { status: 404 })
    }
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [
          { id: 'grok', enabled: true, pinned: true },
          { id: 'claude', enabled: true, pinned: false },
        ],
      },
      store,
      fetch: fetchImpl,
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
    })
    expect(snapshot.providers.map(provider => provider.id)).toEqual(['grok', 'claude'])
    expect(snapshot.providers[0]?.pinned).toBe(true)
    expect(snapshot.providers[1]?.pinned).toBe(false)
  })

  it('keeps last good remaining and the previous fetchedAt when a refresh fails', async () => {
    const store = memoryStore({
      '/home/user/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'claude-token', subscriptionType: 'pro' },
      }),
    })
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [{ id: 'claude', enabled: true, pinned: true }],
      },
      store,
      fetch: async () => new Response('no', { status: 429 }),
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
      previous: previousClaude,
    })
    expect(snapshot.fetchedAt).toBe('2026-09-14T00:10:38.000Z')
    expect(snapshot.providers[0]).toEqual(expect.objectContaining({
      remaining: 0.98,
      error: 'HTTP 429',
      errorKind: 'rate-limit',
      plan: 'Pro',
      credentialSource: 'cli',
      fetchedAt: '2026-09-14T00:00:00.000Z',
    }))
    expect(snapshot.providers[0]?.windows[0]?.remaining).toBe(0.98)
  })

  it('treats HTTP 401 as unauthorized last-good, not signed out', async () => {
    const store = memoryStore({
      '/home/user/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'claude-token', subscriptionType: 'pro' },
      }),
    })
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [{ id: 'claude', enabled: true, pinned: true }],
      },
      store,
      fetch: async () => new Response('no', { status: 401 }),
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
      previous: previousClaude,
    })
    expect(snapshot.providers[0]).toEqual(expect.objectContaining({
      remaining: 0.98,
      error: 'HTTP 401',
      errorKind: 'unauthorized',
      fetchedAt: '2026-09-14T00:00:00.000Z',
      credentialSource: 'cli',
    }))
  })

  it('keeps credentialSource on a failed pull even without last-good remaining', async () => {
    const store = memoryStore({
      '/home/user/.claude/.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'claude-token', subscriptionType: 'pro' },
      }),
    })
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [{ id: 'claude', enabled: true, pinned: true }],
      },
      store,
      fetch: async () => new Response('no', { status: 401 }),
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
    })
    expect(snapshot.providers[0]).toEqual(expect.objectContaining({
      remaining: null,
      error: 'HTTP 401',
      errorKind: 'unauthorized',
      credentialSource: 'cli',
    }))
  })

  it('does not keep last good remaining when signed out', async () => {
    const store = memoryStore({})
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [{ id: 'claude', enabled: true, pinned: true }],
      },
      store,
      fetch: async () => new Response('no', { status: 500 }),
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
      previous: previousClaude,
    })
    expect(snapshot.providers[0]).toEqual(expect.objectContaining({
      remaining: null,
      error: 'signed out',
      errorKind: 'signed-out',
    }))
  })

  it('uses the chosen Primary Window for remaining', async () => {
    const store = memoryStore({
      '/home/user/.codex/auth.json': JSON.stringify({
        tokens: { access_token: 'codex-token', account_id: 'acct' },
      }),
    })
    const snapshot = await readSnapshot({
      settings: {
        remainingMode: true,
        providers: [{ id: 'codex', enabled: true, pinned: true, primary: 'spark-5-hour' }],
      },
      store,
      fetch: async () => jsonResponse('codex-pro.json'),
      now: () => Date.parse('2026-09-14T00:10:38.000Z'),
    })
    const codex = snapshot.providers[0]!
    const chosen = codex.windows.find(window => window.id === 'spark-5-hour')
    expect(chosen?.primary).toBe(true)
    expect(codex.windows.filter(window => window.primary)).toHaveLength(1)
    expect(codex.remaining).toBe(chosen?.remaining)
  })
})

describe('applyPrimary', () => {
  const provider = {
    id: 'cursor',
    name: 'Cursor',
    pinned: true,
    remaining: 0.29,
    accent: '#111111',
    fetchedAt: '2026-09-14T00:00:00.000Z',
    usageUrl: 'https://cursor.com/dashboard',
    statusUrl: 'https://status.cursor.com',
    windows: [
      { id: 'cursor-models', label: 'Cursor Models', remaining: 0.34, resetLabel: '', primary: false },
      { id: 'other-models', label: 'Other Models', remaining: 0, resetLabel: '', primary: false },
    ],
  }

  it('keeps the provider default when no window is chosen', () => {
    expect(applyPrimary(provider)).toBe(provider)
  })

  it('ignores a window id the provider no longer returns', () => {
    expect(applyPrimary(provider, 'weekly')).toBe(provider)
  })

  it('marks the chosen window primary and takes its remaining', () => {
    const next = applyPrimary(provider, 'other-models')
    expect(next.remaining).toBe(0)
    expect(next.windows.map(window => window.primary)).toEqual([false, true])
  })
})
