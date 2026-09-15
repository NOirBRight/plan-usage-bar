import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadSettings, readSnapshot } from './engine.ts'
import { defaultStore, pubConfigDir } from './credentials.ts'
import type { Snapshot } from './snapshot.ts'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'snapshot'
  if (command !== 'snapshot') {
    console.error('Usage: pub-engine snapshot [--out FILE]')
    process.exitCode = 1
    return
  }
  const outFlag = args.indexOf('--out')
  const store = defaultStore()
  const configDir = pubConfigDir(store)
  const cacheDir = join(store.home, '.cache', 'pub')
  const out = outFlag >= 0 && typeof args[outFlag + 1] === 'string'
    ? args[outFlag + 1]!
    : join(cacheDir, 'snapshot.json')
  const settings = await loadSettings(store, configDir)
  const previous = await readPrevious(out)
  const snapshot = await readSnapshot({ settings, store, configDir, previous })
  const json = `${JSON.stringify(snapshot, null, 2)}\n`
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, json)
  process.stdout.write(json)
}

async function readPrevious(path: string): Promise<Snapshot | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const providers = (parsed as Snapshot).providers
    if (!Array.isArray(providers)) return undefined
    return parsed as Snapshot
  } catch {
    return undefined
  }
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : 'pub-engine failed'
  console.error(message)
  process.exitCode = 1
})
