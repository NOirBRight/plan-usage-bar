// Cursor answers 429. Any other URL throws so the CLI test cannot reach the network.
globalThis.fetch = async (input) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (href.includes('cursor.com')) return new Response('no', { status: 429 })
  throw new Error(`network disabled: ${href}`)
}
