import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runCatalogCommand } from './catalog.ts'
import { loadSettings, readSnapshot } from './engine.ts'
import { defaultStore, pubConfigDir } from './credentials.ts'
import { runSettingsCommand } from './settings.ts'
import { SCHEMA_VERSION, type Snapshot } from './snapshot.ts'
import packageJson from '../package.json' with { type: 'json' }

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'snapshot'
  if (command === '--version' || command === 'version') {
    printVersion()
    return
  }
  if (command === 'snapshot') {
    await runSnapshot(args.slice(1))
    return
  }
  if (command === 'settings') {
    await runSettingsCommand(args.slice(1))
    return
  }
  if (command === 'catalog') {
    runCatalogCommand()
    return
  }
  // credentials dispatch from here.
  console.error('Usage: pub-engine snapshot [--out FILE] | pub-engine catalog | pub-engine --version | pub-engine settings | pub-engine settings set …')
  process.exitCode = 1
}

function printVersion(): void {
  const json = `${JSON.stringify({ version: packageJson.version, schemaVersion: SCHEMA_VERSION }, null, 2)}\n`
  process.stdout.write(json)
}

async function runSnapshot(args: readonly string[]): Promise<void> {
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
  const tmp = `${out}.${String(process.pid)}.tmp`
  await writeFile(tmp, json)
  await rename(tmp, out)
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
