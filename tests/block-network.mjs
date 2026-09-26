// CLI tests must not reach the network. A thrown fetch fails the provider as transport.
globalThis.fetch = async (input) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  throw new Error(`network disabled: ${href}`)
}
