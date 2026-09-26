import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'src', 'cli.ts')

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(home: string, args: readonly string[], options?: { stdin?: string, xdg?: string | false }): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
  }
  if (options?.xdg !== false)
    env['XDG_CONFIG_HOME'] = options?.xdg ?? join(home, '.config')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', cli, ...args], {
      cwd: root,
      env,
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
    child.stdin.on('error', () => {
      // A failing command may exit before the pipe is drained.
    })
    child.on('error', reject)
    child.on('close', code => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.stdin.end(options?.stdin ?? '')
  })
}

async function withHome(fn: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'pub-credentials-'))
  try {
    await fn(home)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function credentialsPath(home: string, xdg = join(home, '.config')): string {
  return join(xdg, 'pub', 'credentials.json')
}

async function writeCredentials(home: string, value: unknown, xdg = join(home, '.config')): Promise<string> {
  const path = credentialsPath(home, xdg)
  await mkdir(dirname(path), { recursive: true })
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  await writeFile(path, text)
  return path
}

function ack(id: string): string {
  return `${JSON.stringify({ id }, null, 2)}\n`
}

describe('pub-engine credentials set', () => {
  it('reads the secret from stdin, preserves other entries, and writes mode 0600', async () => {
    await withHome(async home => {
      const path = await writeCredentials(home, {
        grok: { token: 'grok-token', plan: 'heavy' },
        claude: { token: 'old-claude', plan: 'pro' },
      })
      await chmod(path, 0o644)
      const secret = 'claude-secret'
      const result = await run(home, ['credentials', 'set', 'claude'], { stdin: `  ${secret}\n` })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe(ack('claude'))
      expect(result.stdout).not.toContain(secret)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        grok: { token: 'grok-token', plan: 'heavy' },
        claude: { token: secret },
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await readdir(dirname(path))).toEqual(['credentials.json'])
    })
  })

  it('honours XDG_CONFIG_HOME and keeps the secret out of argv', async () => {
    await withHome(async home => {
      const xdg = join(home, 'xdg-config')
      const secret = 'stdin-secret-not-argv'
      const result = await runChecked(home, ['credentials', 'set', 'ollama-cloud'], secret, xdg)
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe(ack('ollama-cloud'))
      expect(result.cmdline).not.toContain(secret)
      expect(result.stdout).not.toContain(secret)
      expect(result.stderr).not.toContain(secret)
      const path = credentialsPath(home, xdg)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        'ollama-cloud': { token: secret },
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      await expect(stat(join(home, '.config', 'pub', 'credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('writes ~/.config/pub/credentials.json when XDG_CONFIG_HOME is unset', async () => {
    await withHome(async home => {
      const secret = 'home-config-secret'
      const result = await run(home, ['credentials', 'set', 'grok'], { stdin: secret, xdg: false })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      const path = join(home, '.config', 'pub', 'credentials.json')
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        grok: { token: secret },
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    })
  })

  it('requires Codex account-id and leaves the file unchanged when it is missing or blank', async () => {
    await withHome(async home => {
      const original = '{\n  "claude": {"token": "keep"}\n}\n'
      const path = await writeCredentials(home, original)
      await chmod(path, 0o644)
      const missing = await run(home, ['credentials', 'set', 'codex'], { stdin: 'codex-secret' })
      expect(missing.code).not.toBe(0)
      expect(missing.stdout).toBe('')
      expect(missing.stderr).toBe('Missing required --account-id\n')
      expect(missing.stderr).not.toContain('codex-secret')
      expect(await readFile(path, 'utf8')).toBe(original)
      expect((await stat(path)).mode & 0o777).toBe(0o644)

      const blank = await run(home, ['credentials', 'set', 'codex', '--account-id', '   '], { stdin: 'codex-secret' })
      expect(blank.code).not.toBe(0)
      expect(blank.stdout).toBe('')
      expect(blank.stderr).toBe('Missing required --account-id\n')
      expect(await readFile(path, 'utf8')).toBe(original)

      const absent = await run(home, ['credentials', 'set', 'codex', '--account-id', ''], { stdin: 'codex-secret' })
      expect(absent.code).not.toBe(0)
      expect(absent.stderr).toBe('Missing required --account-id\n')
      expect(await readFile(path, 'utf8')).toBe(original)
    })
  })

  it('stores Codex account-id without echoing the secret', async () => {
    await withHome(async home => {
      const cliPath = join(home, '.codex', 'auth.json')
      const planted = Buffer.from('{"tokens":{"access_token":"cli-token","account_id":"cli-acct"}}\n')
      await mkdir(dirname(cliPath), { recursive: true })
      await writeFile(cliPath, planted)
      const before = await stat(cliPath)
      const secret = 'pub-codex-secret'
      const result = await run(home, ['credentials', 'set', 'codex', '--account-id', ' acct-1 '], { stdin: secret })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe(ack('codex'))
      expect(result.stdout).not.toContain(secret)
      expect(result.stdout).not.toContain('acct-1')
      const path = credentialsPath(home)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        codex: { token: secret, accountId: 'acct-1' },
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await readFile(cliPath)).toEqual(planted)
      expect((await stat(cliPath)).mtimeMs).toBe(before.mtimeMs)
    })
  })

  it('rejects an unknown provider, a foreign flag, and an empty secret without writing', async () => {
    await withHome(async home => {
      const original = '{"grok":{"token":"keep"}}\n'
      const path = await writeCredentials(home, original)
      const unknown = await run(home, ['credentials', 'set', 'not-a-provider'], { stdin: 'secret' })
      expect(unknown.code).not.toBe(0)
      expect(unknown.stdout).toBe('')
      expect(unknown.stderr).toBe('Unknown provider: not-a-provider\n')
      expect(await readFile(path, 'utf8')).toBe(original)

      const foreign = await run(home, ['credentials', 'set', 'claude', '--user-id', 'user_1'], { stdin: 'secret' })
      expect(foreign.code).not.toBe(0)
      expect(foreign.stdout).toBe('')
      expect(foreign.stderr).toBe('--user-id is not valid for claude\n')
      expect(await readFile(path, 'utf8')).toBe(original)

      const empty = await run(home, ['credentials', 'set', 'claude'], { stdin: ' \n' })
      expect(empty.code).not.toBe(0)
      expect(empty.stdout).toBe('')
      expect(empty.stderr).toBe('Secret is empty\n')
      expect(await readFile(path, 'utf8')).toBe(original)

      const invalid = await writeCredentials(home, '{not json')
      const broken = await run(home, ['credentials', 'set', 'claude'], { stdin: 'secret' })
      expect(broken.code).not.toBe(0)
      expect(broken.stderr).toBe('credentials.json is invalid\n')
      expect(await readFile(invalid, 'utf8')).toBe('{not json')
    })
  })

  it('stores Cursor user-id when given and omits it when the flag is absent', async () => {
    await withHome(async home => {
      const secret = 'cursor-token'
      const withUser = await run(home, ['credentials', 'set', 'cursor', '--user-id', ' user_1 '], { stdin: secret })
      expect(withUser.code).toBe(0)
      expect(withUser.stdout).toBe(ack('cursor'))
      expect(withUser.stdout).not.toContain(secret)
      const path = credentialsPath(home)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        cursor: { token: secret, userId: 'user_1' },
      })
      const omitted = await run(home, ['credentials', 'set', 'cursor'], { stdin: 'jwt-token' })
      expect(omitted.code).toBe(0)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        cursor: { token: 'jwt-token' },
      })
      const blank = await run(home, ['credentials', 'set', 'cursor', '--user-id', ' '], { stdin: 'other-token' })
      expect(blank.code).not.toBe(0)
      expect(blank.stderr).toBe('--user-id must not be blank\n')
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        cursor: { token: 'jwt-token' },
      })
    })
  })
})

describe('pub-engine credentials clear', () => {
  it('removes only that PUB entry and does not modify a CLI credential file', async () => {
    await withHome(async home => {
      const path = await writeCredentials(home, {
        claude: { token: 'claude-token', plan: 'pro' },
        codex: { token: 'codex-token', accountId: 'acct' },
      })
      await chmod(path, 0o644)
      const cliPath = join(home, '.codex', 'auth.json')
      const claudeCli = join(home, '.claude', '.credentials.json')
      const planted = Buffer.from('{"tokens":{"access_token":"cli-token","account_id":"cli-acct"}}\n')
      const claudePlanted = Buffer.from('{"claudeAiOauth":{"accessToken":"cli-claude"}}\n')
      await mkdir(dirname(cliPath), { recursive: true })
      await mkdir(dirname(claudeCli), { recursive: true })
      await writeFile(cliPath, planted)
      await writeFile(claudeCli, claudePlanted)
      await chmod(cliPath, 0o640)
      const before = await stat(cliPath)
      const claudeBefore = await stat(claudeCli)
      const result = await run(home, ['credentials', 'clear', 'codex'])
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toBe(ack('codex'))
      expect(result.stdout).not.toContain('codex-token')
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        claude: { token: 'claude-token', plan: 'pro' },
      })
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(await readdir(dirname(path))).toEqual(['credentials.json'])
      expect(await readFile(cliPath)).toEqual(planted)
      expect(await readFile(claudeCli)).toEqual(claudePlanted)
      expect((await stat(cliPath)).mtimeMs).toBe(before.mtimeMs)
      expect((await stat(cliPath)).mode & 0o777).toBe(0o640)
      expect((await stat(claudeCli)).mtimeMs).toBe(claudeBefore.mtimeMs)
    })
  })

  it('is a no-op for an unknown id or a missing row and writes {} when the last entry goes', async () => {
    await withHome(async home => {
      const original = '{"grok":{"token":"g","plan":"heavy"},"claude":{"token":"c"}}\n'
      const path = await writeCredentials(home, original)
      const unknown = await run(home, ['credentials', 'clear', 'not-a-provider'])
      expect(unknown.code).toBe(0)
      expect(unknown.stderr).toBe('')
      expect(unknown.stdout).toBe(ack('not-a-provider'))
      expect(await readFile(path, 'utf8')).toBe(original)

      const absent = await run(home, ['credentials', 'clear', 'cursor'])
      expect(absent.code).toBe(0)
      expect(absent.stdout).toBe(ack('cursor'))
      expect(await readFile(path, 'utf8')).toBe(original)

      const missingFile = await run(join(home, 'empty-home'), ['credentials', 'clear', 'claude'])
      expect(missingFile.code).toBe(0)
      expect(missingFile.stdout).toBe(ack('claude'))
      await expect(stat(join(home, 'empty-home', '.config', 'pub', 'credentials.json'))).rejects.toMatchObject({ code: 'ENOENT' })

      const clearedGrok = await run(home, ['credentials', 'clear', 'grok'])
      expect(clearedGrok.code).toBe(0)
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        claude: { token: 'c' },
      })
      const clearedClaude = await run(home, ['credentials', 'clear', 'claude'])
      expect(clearedClaude.code).toBe(0)
      expect(await readFile(path, 'utf8')).toBe('{}\n')
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    })
  })
})

interface CheckedRun extends RunResult {
  cmdline: string
}

function runChecked(home: string, args: readonly string[], secret: string, xdg: string): Promise<CheckedRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', cli, ...args], {
      cwd: root,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: home,
        XDG_CONFIG_HOME: xdg,
      },
    })
    let stdout = ''
    let stderr = ''
    let cmdline = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdin.on('error', () => {
      // The child may exit before stdin is consumed on a failing command.
    })
    child.on('error', reject)
    child.on('spawn', () => {
      const pid = child.pid
      if (pid === undefined) {
        reject(new Error('missing pid'))
        return
      }
      readFile(`/proc/${String(pid)}/cmdline`).then(buffer => {
        cmdline = buffer.toString('utf8')
        child.stdin.end(secret)
      }).catch(reject)
    })
    child.on('close', code => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        cmdline,
      })
    })
  })
}
