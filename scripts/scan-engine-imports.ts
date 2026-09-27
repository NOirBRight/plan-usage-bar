import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Import specifiers that are not `node:` URLs. Empty when the source is safe to ship. */
export function disallowedImportSpecifiers(source: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const specifier of importSpecifiers(source)) {
    if (isNodeUrl(specifier) || seen.has(specifier)) continue
    seen.add(specifier)
    found.push(specifier)
  }
  return found
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)(?:\s+type)?\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  const specifiers: string[] = []
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (typeof specifier === 'string' && specifier.length > 0)
        specifiers.push(specifier)
    }
  }
  return specifiers
}

function isNodeUrl(specifier: string): boolean {
  return /^node:\S+$/.test(specifier)
}

async function main(): Promise<void> {
  const file = process.argv[2]
  if (typeof file !== 'string' || file.length === 0) {
    console.error('Usage: scan-engine-imports <file>')
    process.exitCode = 1
    return
  }
  const bad = disallowedImportSpecifiers(await readFile(file, 'utf8'))
  if (bad.length === 0) return
  console.error(`import specifiers must be node: URLs:\n${bad.map(item => `  ${item}`).join('\n')}`)
  process.exitCode = 1
}

function startedAsCli(): boolean {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry.length === 0) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (startedAsCli()) {
  void main().catch(error => {
    const message = error instanceof Error ? error.message : 'scan failed'
    console.error(message)
    process.exitCode = 1
  })
}
