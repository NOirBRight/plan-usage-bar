import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { 'pub-engine': 'src/cli.ts' },
  format: 'esm',
  outDir: 'extension/bin',
  clean: true,
})
