// Serves checked-in usage fixtures. Any other URL throws so the CLI test cannot reach the network.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function json(name) {
  const body = readFileSync(join(fixtures, name), 'utf8')
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

globalThis.fetch = async (input) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (href.includes('cursor.com')) return json('cursor-ultra.json')
  throw new Error(`network disabled: ${href}`)
}
