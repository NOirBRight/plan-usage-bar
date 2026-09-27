import type { ProviderAdapter } from './types.ts'
import { claude } from './claude.ts'
import { codex } from './codex.ts'
import { cursor } from './cursor.ts'
import { grok } from './grok.ts'
import { ollamaCloud } from './ollama.ts'
import { openCodeGo } from './opencode-go.ts'
import { commandCode } from './commandcode.ts'

export const ADAPTERS: Record<string, ProviderAdapter> = {
  claude,
  codex,
  cursor,
  grok,
  'ollama-cloud': ollamaCloud,
  'opencode-go': openCodeGo,
  commandcode: commandCode,
}
