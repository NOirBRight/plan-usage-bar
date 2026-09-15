import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claude } from '../src/providers/claude.ts'
import { codex } from '../src/providers/codex.ts'
import { commandCode } from '../src/providers/commandcode.ts'
import { cursor } from '../src/providers/cursor.ts'
import { grok } from '../src/providers/grok.ts'
import { ollamaCloud } from '../src/providers/ollama.ts'
import { openCodeGo } from '../src/providers/opencode-go.ts'
import { resetLabel } from '../src/remaining.ts'
import { HttpError, type FetchLike } from '../src/http.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const now = Date.parse('2026-09-14T00:10:38.000Z')

function jsonResponse(name: string): Response {
  return new Response(readFileSync(join(fixtures, name), 'utf8'), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function headersOf(init: RequestInit): Record<string, string> {
  const raw = init.headers
  if (raw === undefined || Array.isArray(raw) || raw instanceof Headers) return {}
  return raw as Record<string, string>
}

describe('Claude pull', () => {
  it('keeps Session and Weekly from Pro limits and sends the oauth header', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(String(url)).toContain('api.anthropic.com/api/oauth/usage')
      expect(headersOf(init)['authorization']).toBe('Bearer claude-token')
      expect(headersOf(init)['anthropic-beta']).toBe('oauth-2025-04-20')
      return jsonResponse('claude-pro.json')
    }
    const parsed = await claude.pull({ token: 'claude-token', source: 'cli', plan: 'pro' }, fetchImpl, now)
    expect(parsed.plan).toBe('Pro')
    expect(parsed.windows.map(window => window.label)).toEqual(['Session', 'Weekly'])
    expect(parsed.windows.map(window => window.remaining)).toEqual([1, 0.98])
    expect(parsed.remaining).toBe(0.98)
    expect(parsed.extra).toBeUndefined()
    expect(parsed.windows[1]?.resetLabel).toBe('Resets in 3d 20h')
  })
})

describe('Codex pull', () => {
  it('draws Weekly plus Spark 5-hour and Spark Weekly', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(String(url)).toContain('chatgpt.com/backend-api/wham/usage')
      expect(headersOf(init)['chatgpt-account-id']).toBe('acct')
      return jsonResponse('codex-pro.json')
    }
    const parsed = await codex.pull(
      { token: 'codex-token', accountId: 'acct', source: 'cli' },
      fetchImpl,
      now,
    )
    expect(parsed.plan).toBe('Pro')
    expect(parsed.windows.map(window => window.label)).toEqual(['Weekly', 'Spark · 5-hour', 'Spark · Weekly'])
    expect(parsed.windows.map(window => window.remaining)).toEqual([0.64, 1, 1])
    expect(parsed.remaining).toBe(0.64)
  })
})

describe('Cursor pull', () => {
  it('draws a Total primary window matching remaining', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(String(url)).toContain('cursor.com/api/usage-summary')
      expect(headersOf(init)['cookie']).toBe(
        `WorkosCursorSessionToken=${encodeURIComponent('user_abc::cursor-token')}`,
      )
      return jsonResponse('cursor-ultra.json')
    }
    const parsed = await cursor.pull(
      { token: 'cursor-token', userId: 'user_abc', source: 'pub' },
      fetchImpl,
      now,
    )
    expect(parsed.plan).toBe('Ultra')
    expect(parsed.windows.map(window => window.label)).toEqual(['Cursor Models', 'Other Models', 'Total'])
    expect(parsed.windows[0]?.remaining).toBeCloseTo(0.411353, 5)
    expect(parsed.windows[1]?.remaining).toBe(0)
    expect(parsed.windows[2]?.primary).toBe(true)
    expect(parsed.remaining).toBeCloseTo(0.352566, 5)
    expect(parsed.remaining).toBe(parsed.windows[2]?.remaining)
    expect(parsed.extraNote).toBe('On-demand off')
  })
})

describe('Grok pull', () => {
  it('treats creditUsagePercent 1.0 as 1% used on Weekly', async () => {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      urls.push(String(url))
      if (String(url).includes('/v1/settings')) {
        return new Response(JSON.stringify({ subscription_tier_display: 'SuperGrok Heavy' }), { status: 200 })
      }
      return jsonResponse('grok-heavy.json')
    }
    const parsed = await grok.pull({ token: 'grok-token', source: 'cli' }, fetchImpl, now)
    expect(urls.some(url => url.includes('billing?format=credits'))).toBe(true)
    expect(urls.some(url => url.includes('/v1/settings'))).toBe(true)
    expect(parsed.plan).toBe('SuperGrok Heavy')
    expect(parsed.windows).toHaveLength(1)
    expect(parsed.windows[0]?.label).toBe('Weekly')
    expect(parsed.remaining).toBe(0.99)
    expect(parsed.windows[0]?.resetLabel).toBe('Resets in 6d 16h')
  })
})

describe('Ollama Cloud pull', () => {
  it('draws only Monthly when that is the sole limits key', async () => {
    const parsed = await ollamaCloud.pull(
      { token: 'ollama-key', source: 'pub' },
      async () => jsonResponse('ollama-monthly.json'),
      now,
    )
    expect(parsed.windows.map(window => window.label)).toEqual(['Monthly'])
    expect(parsed.remaining).toBeCloseTo(0.999, 6)
    expect(parsed.cost?.month).toBe('$0.00 · last 4 weeks')
    expect(parsed.note).toContain('Monthly')
  })

  it('draws 5-hour and Weekly when both limits exist', async () => {
    const parsed = await ollamaCloud.pull(
      { token: 'ollama-key', source: 'pub' },
      async () => jsonResponse('ollama-pro.json'),
      now,
    )
    expect(parsed.windows.map(window => window.label)).toEqual(['5-hour', 'Weekly'])
    expect(parsed.windows[0]?.remaining).toBeCloseTo(0.812, 3)
    expect(parsed.windows[1]?.remaining).toBeCloseTo(0.46, 3)
    expect(parsed.remaining).toBeCloseTo(0.46, 3)
  })
})

describe('OpenCode Go pull', () => {
  it('treats usage percent as used and defaults Primary to Monthly', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(String(url)).toBe('https://opencode.ai/zen/go/v1/usage')
      expect(headersOf(init)['authorization']).toBe('Bearer go-key')
      expect(headersOf(init)['x-opencode-session']).toBe('ses_pub-usage')
      expect(headersOf(init)['user-agent']).toBe('pub-engine')
      return jsonResponse('opencode-go.json')
    }
    const parsed = await openCodeGo.pull({ token: 'go-key', source: 'pub' }, fetchImpl, now)
    expect(parsed.windows.map(window => window.id)).toEqual(['session', 'weekly', 'monthly'])
    expect(parsed.windows.map(window => window.label)).toEqual(['5-hour', 'Weekly', 'Monthly'])
    expect(parsed.windows.map(window => window.remaining)).toEqual([0.96, 0.7, 0.99])
    expect(parsed.windows.find(window => window.primary)?.id).toBe('monthly')
    expect(parsed.remaining).toBe(0.99)
  })

  it('accepts rollingUsage as the 5-hour window alias', async () => {
    const parsed = await openCodeGo.pull(
      { token: 'go-key', source: 'pub' },
      async () => new Response(JSON.stringify({
        rollingUsage: { percent: 20 },
        weekly: { percent: 40 },
        monthlyUsage: { percent: 10 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      now,
    )
    expect(parsed.windows.map(window => window.id)).toEqual(['session', 'weekly', 'monthly'])
    expect(parsed.remaining).toBe(0.9)
  })

  it('defaults Primary to Weekly when Monthly is absent', async () => {
    const parsed = await openCodeGo.pull(
      { token: 'go-key', source: 'pub' },
      async () => new Response(JSON.stringify({
        rolling: { percent: 10 },
        weekly: { percent: 40 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      now,
    )
    expect(parsed.windows.map(window => window.id)).toEqual(['session', 'weekly'])
    expect(parsed.windows.find(window => window.primary)?.id).toBe('weekly')
    expect(parsed.remaining).toBe(0.6)
  })
})

describe('Command Code pull', () => {
  it('uses monthly remaining vs GOAT pool as Primary, not the Weekly window', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push(String(url))
      expect(headersOf(init)['authorization']).toBe('Bearer cmd-key')
      const href = String(url)
      if (href.endsWith('/alpha/whoami')) return jsonResponse('commandcode-whoami.json')
      if (href.includes('/alpha/billing/credits')) return jsonResponse('commandcode-credits.json')
      if (href.includes('/alpha/billing/subscriptions')) return jsonResponse('commandcode-subscription.json')
      if (href.includes('/alpha/usage/summary')) return jsonResponse('commandcode-summary.json')
      throw new Error('unexpected URL ' + href)
    }
    const parsed = await commandCode.pull({ token: 'cmd-key', source: 'pub' }, fetchImpl, now)
    expect(seen[0]).toContain('/alpha/whoami')
    expect(seen.some(url => url.includes('/alpha/billing/credits'))).toBe(true)
    expect(seen.some(url => url.includes('/alpha/billing/subscriptions'))).toBe(true)
    expect(seen.some(url => url.includes('/alpha/usage/summary'))).toBe(true)
    expect(seen.findIndex(url => url.includes('/alpha/usage/summary')))
      .toBeGreaterThan(seen.findIndex(url => url.includes('/alpha/billing/credits')))
    expect(parsed.plan).toBe('GOAT')
    const monthly = parsed.windows.find(window => window.id === 'monthly')
    const weekly = parsed.windows.find(window => window.id === 'weekly')
    const session = parsed.windows.find(window => window.id === 'session')
    expect(monthly?.primary).toBe(true)
    expect(parsed.remaining).toBeCloseTo(4.73 / 70, 5)
    expect(weekly?.remaining).toBeCloseTo(1 - 3.22 / 35, 5)
    expect(parsed.remaining).not.toBeCloseTo(weekly?.remaining ?? 0, 2)
    expect(session?.remaining).toBe(1)
    expect(session?.resetsAt).toBeUndefined()
    expect(weekly?.resetsAt).toBe('2026-09-17T03:38:53.975Z')
    expect(parsed.cost?.month).toBe('$4.73 remaining')
    expect(parsed.extraNote).toContain('2.50')
  })

  it('keeps monthly remaining when summary fails and the plan table supplies the pool', async () => {
    const fetchImpl: FetchLike = async (url) => {
      const href = String(url)
      if (href.endsWith('/alpha/whoami')) return jsonResponse('commandcode-whoami.json')
      if (href.includes('/alpha/billing/credits')) return jsonResponse('commandcode-credits.json')
      if (href.includes('/alpha/billing/subscriptions')) return jsonResponse('commandcode-subscription.json')
      return new Response('', { status: 503 })
    }
    const parsed = await commandCode.pull({ token: 'cmd-key', source: 'cli' }, fetchImpl, now)
    expect(parsed.remaining).toBeCloseTo(4.73 / 70, 5)
    expect(parsed.plan).toBe('GOAT')
  })

  it('still draws Monthly when windowLimits are missing', async () => {
    const fetchImpl: FetchLike = async (url) => {
      const href = String(url)
      if (href.endsWith('/alpha/whoami')) return jsonResponse('commandcode-whoami.json')
      if (href.includes('/alpha/billing/credits')) {
        return new Response(JSON.stringify({ credits: { monthlyCredits: 4.73 } }), { status: 200 })
      }
      if (href.includes('/alpha/billing/subscriptions')) return jsonResponse('commandcode-subscription.json')
      return jsonResponse('commandcode-summary.json')
    }
    const parsed = await commandCode.pull({ token: 'cmd-key', source: 'pub' }, fetchImpl, now)
    expect(parsed.windows.map(window => window.id)).toEqual(['monthly'])
    expect(parsed.remaining).toBeCloseTo(4.73 / 70, 5)
  })

  it('throws unauthorized when credits answers 401', async () => {
    const fetchImpl: FetchLike = async (url) => {
      const href = String(url)
      if (href.endsWith('/alpha/whoami')) return jsonResponse('commandcode-whoami.json')
      if (href.includes('/alpha/billing/credits')) return new Response('', { status: 401 })
      return jsonResponse('commandcode-subscription.json')
    }
    await expect(commandCode.pull({ token: 'bad', source: 'pub' }, fetchImpl, now))
      .rejects.toMatchObject({ status: 401 })
    await expect(commandCode.pull({ token: 'bad', source: 'pub' }, fetchImpl, now))
      .rejects.toBeInstanceOf(HttpError)
  })
})

describe('resetLabel', () => {
  it('floors to days then hours', () => {
    expect(resetLabel('2026-09-17T20:59:59.994Z', now)).toBe('Resets in 3d 20h')
  })
})
