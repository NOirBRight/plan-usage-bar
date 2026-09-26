import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/snapshot.ts'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'src', 'cli.ts')
const knownIds = DEFAULT_SETTINGS.providers.map(row => row.id)

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(home: string, args: readonly string[], xdg = true): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
  }
  if (xdg)
    env['XDG_CONFIG_HOME'] = join(home, '.config')
  return execFileAsync(process.execPath, ['--experimental-strip-types', cli, ...args], {
    cwd: root,
    env,
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
  const home = await mkdtemp(join(tmpdir(), 'pub-settings-'))
  try {
    await fn(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function settingsPath(home: string): string {
  return join(home, '.config', 'pub', 'settings.json')
}

async function writeSettings(home: string, value: unknown): Promise<string> {
  const path = settingsPath(home)
  await mkdir(dirname(path), { recursive: true })
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  await writeFile(path, text)
  return path
}

describe('pub-engine settings', () => {
  it('prints the default merge and does not create a file', async () => {
    await withHome(async home => {
      const result = await run(home, ['settings'])
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe(`${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
      await expect(stat(settingsPath(home))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('prints the same merged settings snapshot uses', async () => {
    await withHome(async home => {
      const path = await writeSettings(home, {
        remainingMode: false,
        providers: [
          { id: 'grok', enabled: true, pinned: true, primary: 'weekly' },
          { id: 'grok', enabled: false, pinned: false },
          { id: 'claude', enabled: false, pinned: true },
          { id: 'extra-tool', enabled: true, pinned: false },
        ],
      })
      const before = await readFile(path)
      const listed = await run(home, ['settings'])
      expect(listed.code).toBe(0)
      expect(listed.stderr).toBe('')
      const settings = JSON.parse(listed.stdout) as {
        remainingMode: boolean
        providers: { id: string, enabled: boolean, pinned: boolean, primary?: string }[]
      }
      expect(settings).toEqual({
        remainingMode: false,
        providers: [
          { id: 'grok', enabled: true, pinned: true, primary: 'weekly' },
          { id: 'claude', enabled: false, pinned: true },
          { id: 'extra-tool', enabled: true, pinned: false },
          { id: 'codex', enabled: true, pinned: true },
          { id: 'cursor', enabled: true, pinned: true },
          { id: 'ollama-cloud', enabled: true, pinned: false },
          { id: 'opencode-go', enabled: true, pinned: false },
          { id: 'commandcode', enabled: true, pinned: false },
        ],
      })
      const shot = await run(home, ['snapshot', '--out', join(home, 'snapshot.json')])
      expect(shot.code).toBe(0)
      const snapshot = JSON.parse(shot.stdout) as { remainingMode: boolean, providers: { id: string }[] }
      expect(snapshot.remainingMode).toBe(settings.remainingMode)
      expect(snapshot.providers.map(provider => provider.id)).toEqual(
        settings.providers.filter(provider => provider.enabled && knownIds.includes(provider.id)).map(provider => provider.id),
      )
      expect(await readFile(path)).toEqual(before)
    })
  })

  it('reads ~/.config/pub when XDG_CONFIG_HOME is unset', async () => {
    await withHome(async home => {
      await writeSettings(home, { remainingMode: false, providers: [{ id: 'cursor', enabled: true, pinned: false }] })
      const result = await run(home, ['settings'], false)
      expect(result.code).toBe(0)
      const settings = JSON.parse(result.stdout) as { remainingMode: boolean, providers: { id: string }[] }
      expect(settings.remainingMode).toBe(false)
      expect(settings.providers[0]?.id).toBe('cursor')
    })
  })

  it('treats an unreadable settings file like snapshot and leaves the bytes', async () => {
    await withHome(async home => {
      const path = await writeSettings(home, '{not json')
      const result = await run(home, ['settings'])
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(DEFAULT_SETTINGS)
      expect(await readFile(path, 'utf8')).toBe('{not json')
    })
  })
})

describe('pub-engine settings set', () => {
  it('sets remaining mode and preserves every other row', async () => {
    await withHome(async home => {
      await writeSettings(home, {
        remainingMode: true,
        providers: [
          { id: 'claude', enabled: true, pinned: true, primary: 'weekly_all' },
          { id: 'extra-tool', enabled: false, pinned: false, primary: 'weekly' },
        ],
      })
      const result = await run(home, ['settings', 'set', 'remaining-mode', 'false'])
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      const path = settingsPath(home)
      expect(await readFile(path, 'utf8')).toBe(result.stdout)
      const settings = JSON.parse(result.stdout) as {
        remainingMode: boolean
        providers: { id: string, enabled: boolean, pinned: boolean, primary?: string }[]
      }
      expect(settings.remainingMode).toBe(false)
      expect(settings.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: true, pinned: true, primary: 'weekly_all',
      })
      expect(settings.providers.find(row => row.id === 'extra-tool')).toEqual({
        id: 'extra-tool', enabled: false, pinned: false, primary: 'weekly',
      })
      expect(await readdir(dirname(path))).toEqual(['settings.json'])
    })
  })

  it('sets enabled and clears pinned when disabling', async () => {
    await withHome(async home => {
      const enabled = await run(home, ['settings', 'set', 'enabled', 'ollama-cloud', 'false'])
      expect(enabled.code).toBe(0)
      const off = JSON.parse(enabled.stdout) as { providers: { id: string, enabled: boolean, pinned: boolean }[] }
      expect(off.providers.find(row => row.id === 'ollama-cloud')).toEqual({
        id: 'ollama-cloud', enabled: false, pinned: false,
      })
      expect(off.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: true, pinned: true,
      })
      const disabled = await run(home, ['settings', 'set', 'enabled', 'claude', 'false'])
      expect(disabled.code).toBe(0)
      const claude = JSON.parse(disabled.stdout) as { providers: { id: string, enabled: boolean, pinned: boolean }[] }
      expect(claude.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: false, pinned: false,
      })
      expect(claude.providers.find(row => row.id === 'codex')).toEqual({
        id: 'codex', enabled: true, pinned: true,
      })
      const again = await run(home, ['settings', 'set', 'enabled', 'claude', 'true'])
      const restored = JSON.parse(again.stdout) as { providers: { id: string, enabled: boolean, pinned: boolean }[] }
      expect(restored.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: true, pinned: false,
      })
    })
  })

  it('sets pinned without a strip cap', async () => {
    await withHome(async home => {
      for (const id of ['ollama-cloud', 'opencode-go', 'commandcode']) {
        const result = await run(home, ['settings', 'set', 'pinned', id, 'true'])
        expect(result.code).toBe(0)
      }
      const settings = JSON.parse((await run(home, ['settings'])).stdout) as {
        providers: { id: string, pinned: boolean, enabled: boolean }[]
      }
      expect(settings.providers.filter(row => row.pinned).map(row => row.id)).toEqual(knownIds)
      const unpinned = await run(home, ['settings', 'set', 'pinned', 'codex', 'false'])
      expect(unpinned.code).toBe(0)
      const codex = JSON.parse(unpinned.stdout) as { providers: { id: string, pinned: boolean, enabled: boolean }[] }
      expect(codex.providers.find(row => row.id === 'codex')).toEqual({
        id: 'codex', enabled: true, pinned: false,
      })
      expect(codex.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: true, pinned: true,
      })
    })
  })

  it('allows pinned on a disabled row', async () => {
    await withHome(async home => {
      expect((await run(home, ['settings', 'set', 'enabled', 'grok', 'false'])).code).toBe(0)
      const result = await run(home, ['settings', 'set', 'pinned', 'grok', 'true'])
      expect(result.code).toBe(0)
      const settings = JSON.parse(result.stdout) as { providers: { id: string, enabled: boolean, pinned: boolean }[] }
      expect(settings.providers.find(row => row.id === 'grok')).toEqual({
        id: 'grok', enabled: false, pinned: true,
      })
    })
  })

  it('sets an accepted primary and clears it', async () => {
    await withHome(async home => {
      const accepted = await run(home, ['settings', 'set', 'primary', 'cursor', 'cursor-models'])
      expect(accepted.code).toBe(0)
      expect(accepted.stderr).toBe('')
      const withPrimary = JSON.parse(accepted.stdout) as { providers: { id: string, primary?: string, pinned: boolean }[] }
      expect(withPrimary.providers.find(row => row.id === 'cursor')?.primary).toBe('cursor-models')
      expect(withPrimary.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: true, pinned: true,
      })
      const spark = await run(home, ['settings', 'set', 'primary', 'codex', 'spark-5-hour'])
      expect(spark.code).toBe(0)
      expect(JSON.parse(spark.stdout).providers.find((row: { id: string }) => row.id === 'codex').primary).toBe('spark-5-hour')
      const cleared = await run(home, ['settings', 'set', 'primary', 'cursor', '--clear'])
      expect(cleared.code).toBe(0)
      const cursor = JSON.parse(cleared.stdout).providers.find((row: { id: string }) => row.id === 'cursor')
      expect(cursor.primary).toBeUndefined()
      expect(Object.hasOwn(cursor, 'primary')).toBe(false)
      expect(JSON.parse(cleared.stdout).providers.find((row: { id: string }) => row.id === 'codex').primary).toBe('spark-5-hour')
    })
  })

  it('rejects an unknown quota window and leaves the file untouched', async () => {
    await withHome(async home => {
      const path = await writeSettings(home, '{"remainingMode":true,"providers":[{"id":"cursor","enabled":true,"pinned":true}]}\n')
      const before = await readFile(path)
      const rejected = await run(home, ['settings', 'set', 'primary', 'cursor', 'not-a-window'])
      expect(rejected.code).not.toBe(0)
      expect(rejected.stdout).toBe('')
      expect(rejected.stderr).toMatch(/Unknown quota window: not-a-window/)
      expect(await readFile(path)).toEqual(before)
      const otherProvider = await run(home, ['settings', 'set', 'primary', 'claude', 'cursor-models'])
      expect(otherProvider.code).not.toBe(0)
      expect(otherProvider.stderr).toMatch(/Unknown quota window: cursor-models/)
      expect(await readFile(path)).toEqual(before)
    })
  })

  it('reorders known providers and keeps rows it does not mention', async () => {
    await withHome(async home => {
      await writeSettings(home, {
        remainingMode: false,
        providers: [
          { id: 'claude', enabled: true, pinned: true, primary: 'session' },
          { id: 'extra-tool', enabled: true, pinned: true, primary: 'weekly' },
        ],
      })
      const order = [...knownIds].reverse()
      const result = await run(home, ['settings', 'set', 'order', ...order])
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      const settings = JSON.parse(result.stdout) as {
        remainingMode: boolean
        providers: { id: string, enabled: boolean, pinned: boolean, primary?: string }[]
      }
      expect(settings.remainingMode).toBe(false)
      expect(settings.providers.map(row => row.id)).toEqual([...order, 'extra-tool'])
      expect(settings.providers.find(row => row.id === 'claude')).toEqual({
        id: 'claude', enabled: true, pinned: true, primary: 'session',
      })
      expect(settings.providers.find(row => row.id === 'extra-tool')).toEqual({
        id: 'extra-tool', enabled: true, pinned: true, primary: 'weekly',
      })
      expect(settings.providers.find(row => row.id === 'codex')).toEqual({
        id: 'codex', enabled: true, pinned: true,
      })
    })
  })

  it('rejects unknown providers and incomplete order without creating or changing the file', async () => {
    await withHome(async home => {
      const missing = await run(home, ['settings', 'set', 'enabled', 'nope', 'true'])
      expect(missing.code).not.toBe(0)
      expect(missing.stdout).toBe('')
      expect(missing.stderr).toMatch(/Unknown provider: nope/)
      await expect(stat(settingsPath(home))).rejects.toMatchObject({ code: 'ENOENT' })

      const path = await writeSettings(home, '{\n  "remainingMode": true\n}\n')
      const before = await readFile(path)
      const pinned = await run(home, ['settings', 'set', 'pinned', 'nope', 'false'])
      expect(pinned.code).not.toBe(0)
      expect(pinned.stderr).toMatch(/Unknown provider: nope/)
      expect(await readFile(path)).toEqual(before)

      const primary = await run(home, ['settings', 'set', 'primary', 'nope', '--clear'])
      expect(primary.code).not.toBe(0)
      expect(primary.stderr).toMatch(/Unknown provider: nope/)
      expect(await readFile(path)).toEqual(before)

      const partial = await run(home, ['settings', 'set', 'order', 'claude', 'codex'])
      expect(partial.code).not.toBe(0)
      expect(partial.stderr).toMatch(/Order must list every known provider exactly once/)
      expect(await readFile(path)).toEqual(before)

      const alien = await run(home, ['settings', 'set', 'order', 'nope', ...knownIds])
      expect(alien.code).not.toBe(0)
      expect(alien.stderr).toMatch(/Unknown provider: nope/)
      expect(await readFile(path)).toEqual(before)

      const duplicate = await run(home, ['settings', 'set', 'order', 'claude', ...knownIds])
      expect(duplicate.code).not.toBe(0)
      expect(duplicate.stderr).toMatch(/Order must list every known provider exactly once/)
      expect(await readFile(path)).toEqual(before)

      const badMode = await run(home, ['settings', 'set', 'remaining-mode', 'yes'])
      expect(badMode.code).not.toBe(0)
      expect(badMode.stdout).toBe('')
      expect(badMode.stderr).toMatch(/Usage:/)
      expect(await readFile(path)).toEqual(before)
    })
  })
})
