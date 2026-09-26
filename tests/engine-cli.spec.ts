import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'src', 'cli.ts')
const blockNetwork = join(root, 'tests', 'block-network.mjs')
const fixtureFetch = join(root, 'tests', 'fixture-fetch.mjs')
const fixtureFetch429 = join(root, 'tests', 'fixture-fetch-429.mjs')

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[], home: string, preload = blockNetwork): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      preload,
      cli,
      ...args,
    ], {
      cwd: root,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: home,
        TMPDIR: tmpdir(),
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_CACHE_HOME: join(home, '.cache'),
        XDG_DATA_HOME: join(home, '.local', 'share'),
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

describe('pub-engine snapshot', () => {
  const homes: string[] = []

  afterEach(async () => {
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
  })

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'pub-engine-'))
    homes.push(home)
    return home
  }

  it('writes integer schemaVersion 1 to stdout and the snapshot file', async () => {
    const home = await tempHome()
    const out = join(home, 'snapshot.json')
    const result = await runCli(['snapshot', '--out', out], home)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const stdout = JSON.parse(result.stdout) as { schemaVersion?: unknown }
    const file = JSON.parse(await readFile(out, 'utf8')) as { schemaVersion?: unknown }
    expect(stdout.schemaVersion).toBe(1)
    expect(Number.isInteger(stdout.schemaVersion)).toBe(true)
    expect(file).toEqual(stdout)
  })

  it('gives every Provider a shortName, shortening only the narrow-screen names', async () => {
    const home = await tempHome()
    const out = join(home, 'snapshot.json')
    const result = await runCli(['snapshot', '--out', out], home)
    expect(result.code).toBe(0)
    const snapshot = JSON.parse(result.stdout) as {
      providers: Array<{ name?: string, shortName?: string }>
    }
    const file = JSON.parse(await readFile(out, 'utf8')) as typeof snapshot
    expect(file).toEqual(snapshot)
    expect(snapshot.providers.map(provider => [provider.name, provider.shortName])).toEqual([
      ['Claude', 'Claude'],
      ['Codex', 'Codex'],
      ['Cursor', 'Cursor'],
      ['Grok', 'Grok'],
      ['Ollama Cloud', 'Ollama'],
      ['OpenCode Go', 'OpenCode'],
      ['Command Code', 'Cmd Code'],
    ])
  })

  it('gives every Quota Window a shortLabel, shortening Cursor model labels', async () => {
    const home = await tempHome()
    const configDir = join(home, '.config', 'pub')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'credentials.json'), JSON.stringify({
      cursor: { token: 'cursor-token', userId: 'user_abc' },
    }))
    const out = join(home, 'snapshot.json')
    const result = await runCli(['snapshot', '--out', out], home, fixtureFetch)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const snapshot = JSON.parse(result.stdout) as {
      providers: Array<{ id: string, windows: Array<{ label: string, shortLabel?: string }> }>
    }
    const file = JSON.parse(await readFile(out, 'utf8')) as typeof snapshot
    expect(file).toEqual(snapshot)
    const cursor = snapshot.providers.find(provider => provider.id === 'cursor')
    expect(cursor?.windows.map(window => [window.label, window.shortLabel])).toEqual([
      ['Cursor Models', 'Cursor'],
      ['Other Models', 'Other'],
      ['Total', 'Total'],
    ])
  })

  it('defaults to snapshot when argv is empty', async () => {
    const home = await tempHome()
    const result = await runCli([], home)
    expect(result.code).toBe(0)
    const snapshot = JSON.parse(result.stdout) as { schemaVersion?: unknown }
    const file = JSON.parse(await readFile(join(home, '.cache', 'pub', 'snapshot.json'), 'utf8')) as typeof snapshot
    expect(snapshot.schemaVersion).toBe(1)
    expect(file).toEqual(snapshot)
  })

  it('stamps shortLabel onto last-good windows that were saved without it', async () => {
    const home = await tempHome()
    const configDir = join(home, '.config', 'pub')
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'credentials.json'), JSON.stringify({
      cursor: { token: 'cursor-token', userId: 'user_abc' },
    }))
    const out = join(home, 'snapshot.json')
    await writeFile(out, JSON.stringify({
      fetchedAt: '2026-09-14T00:00:00.000Z',
      remainingMode: true,
      providers: [{
        id: 'cursor',
        name: 'Cursor',
        pinned: true,
        remaining: 0.34,
        accent: '#111111',
        fetchedAt: '2026-09-14T00:00:00.000Z',
        usageUrl: 'https://cursor.com/dashboard',
        statusUrl: 'https://status.cursor.com',
        windows: [
          { id: 'cursor-models', label: 'Cursor Models', remaining: 0.34, resetLabel: '', primary: false },
          { id: 'other-models', label: 'Other Models', remaining: 0, resetLabel: '', primary: true },
        ],
      }],
    }))
    const result = await runCli(['snapshot', '--out', out], home, fixtureFetch429)
    expect(result.code).toBe(0)
    const snapshot = JSON.parse(result.stdout) as {
      providers: Array<{ id: string, errorKind?: string, windows: Array<{ label: string, shortLabel?: string }> }>
    }
    const file = JSON.parse(await readFile(out, 'utf8')) as typeof snapshot
    expect(file).toEqual(snapshot)
    const cursor = snapshot.providers.find(provider => provider.id === 'cursor')
    expect(cursor?.errorKind).toBe('rate-limit')
    expect(cursor?.windows.map(window => [window.label, window.shortLabel])).toEqual([
      ['Cursor Models', 'Cursor'],
      ['Other Models', 'Other'],
    ])
  })
})

describe('pub-engine --version', () => {
  const homes: string[] = []

  afterEach(async () => {
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
  })

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'pub-engine-'))
    homes.push(home)
    return home
  }

  it.each(['--version', 'version'])('prints the Engine version and schemaVersion as JSON for %s', async (command) => {
    const home = await tempHome()
    const result = await runCli([command], home)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      version: packageJson.version,
      schemaVersion: 1,
    })
  })
})
