import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseClaudeUsage } from '../src/providers/claude.ts'
import { parseCodexUsage } from '../src/providers/codex.ts'
import { parseCursorUsage } from '../src/providers/cursor.ts'
import { parseGrokUsage } from '../src/providers/grok.ts'
import { parseOllamaUsage } from '../src/providers/ollama.ts'
import { resetLabel } from '../src/remaining.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const now = Date.parse('2026-09-14T00:10:38.000Z')

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as unknown
}

describe('Claude limits', () => {
  it('keeps Session and Weekly from Pro limits and drops Sonnet', () => {
    const parsed = parseClaudeUsage(load('claude-pro.json'), now, 'pro')
    expect(parsed.plan).toBe('Pro')
    expect(parsed.windows.map(window => window.label)).toEqual(['Session', 'Weekly'])
    expect(parsed.windows.map(window => window.remaining)).toEqual([1, 0.98])
    expect(parsed.remaining).toBe(0.98)
    expect(parsed.extra).toBeUndefined()
    expect(parsed.windows[1]?.resetLabel).toBe('Resets in 3d 20h')
  })
})

describe('Codex rate limits', () => {
  it('draws Weekly plus Spark 5-hour and Spark Weekly', () => {
    const parsed = parseCodexUsage(load('codex-pro.json'), now)
    expect(parsed.plan).toBe('Pro')
    expect(parsed.windows.map(window => window.label)).toEqual(['Weekly', 'Spark · 5-hour', 'Spark · Weekly'])
    expect(parsed.windows.map(window => window.remaining)).toEqual([0.64, 1, 1])
    expect(parsed.remaining).toBe(0.64)
  })
})

describe('Cursor usage-summary', () => {
  it('draws Cursor Models and Other Models from the Ultra summary', () => {
    const parsed = parseCursorUsage(load('cursor-ultra.json'), now)
    expect(parsed.plan).toBe('Ultra')
    expect(parsed.windows.map(window => window.label)).toEqual(['Cursor Models', 'Other Models'])
    expect(parsed.windows[0]?.remaining).toBeCloseTo(0.411353, 5)
    expect(parsed.windows[1]?.remaining).toBe(0)
    expect(parsed.remaining).toBeCloseTo(0.352566, 5)
    expect(parsed.extraNote).toBe('On-demand off')
  })
})

describe('Grok billing credits', () => {
  it('treats creditUsagePercent 1.0 as 1% used on Weekly', () => {
    const parsed = parseGrokUsage(load('grok-heavy.json'), now, 'SuperGrok Heavy')
    expect(parsed.plan).toBe('SuperGrok Heavy')
    expect(parsed.windows).toHaveLength(1)
    expect(parsed.windows[0]?.label).toBe('Weekly')
    expect(parsed.remaining).toBe(0.99)
    expect(parsed.windows[0]?.resetLabel).toBe('Resets in 6d 16h')
  })
})

describe('Ollama Cloud limits', () => {
  it('draws only Monthly when that is the sole limits key', () => {
    const parsed = parseOllamaUsage(load('ollama-monthly.json'), now)
    expect(parsed.windows.map(window => window.label)).toEqual(['Monthly'])
    expect(parsed.remaining).toBeCloseTo(0.999, 6)
    expect(parsed.cost?.month).toBe('$0.00 · last 4 weeks')
    expect(parsed.note).toContain('Monthly')
  })

  it('draws 5-hour and Weekly when both limits exist', () => {
    const parsed = parseOllamaUsage(load('ollama-pro.json'), now)
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
