import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claude } from '../src/providers/claude.ts'
import { codex } from '../src/providers/codex.ts'
import { cursor } from '../src/providers/cursor.ts'
import { grok } from '../src/providers/grok.ts'
import { ollamaCloud } from '../src/providers/ollama.ts'
import { resetLabel } from '../src/remaining.ts'
import type { FetchLike } from '../src/http.ts'

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

describe('resetLabel', () => {
  it('floors to days then hours', () => {
    expect(resetLabel('2026-09-17T20:59:59.994Z', now)).toBe('Resets in 3d 20h')
  })
})
