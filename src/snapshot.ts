/** Snapshot JSON the GNOME extension reads. Engine-only types. */

export interface QuotaWindow {
  id: string
  label: string
  remaining: number | null
  resetsAt?: string
  resetLabel: string
  primary: boolean
}

export interface ProviderSnapshot {
  id: string
  name: string
  plan?: string
  pinned: boolean
  remaining: number | null
  accent: string
  fetchedAt: string
  usageUrl: string
  statusUrl: string
  extra?: { label: string, usedFraction: number }
  extraNote?: string
  cost?: { today?: string, month?: string }
  note?: string
  error?: string
  credentialSource?: 'pub' | 'cli'
  windows: QuotaWindow[]
}

export interface Snapshot {
  fetchedAt: string
  remainingMode: boolean
  providers: ProviderSnapshot[]
}

export interface ProviderSettings {
  id: string
  enabled: boolean
  pinned: boolean
  /** Quota Window id chosen as Primary Window; absent = provider default. */
  primary?: string
}

export interface PubSettings {
  remainingMode: boolean
  providers: ProviderSettings[]
}

export const DEFAULT_SETTINGS: PubSettings = {
  remainingMode: true,
  providers: [
    { id: 'claude', enabled: true, pinned: true },
    { id: 'codex', enabled: true, pinned: true },
    { id: 'cursor', enabled: true, pinned: true },
    { id: 'grok', enabled: true, pinned: true },
    { id: 'ollama-cloud', enabled: true, pinned: false },
  ],
}

export interface ProviderIdentity {
  id: string
  name: string
  accent: string
  usageUrl: string
  statusUrl: string
}

export const IDENTITIES: Record<string, ProviderIdentity> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    accent: '#C96442',
    usageUrl: 'https://claude.ai/settings/usage',
    statusUrl: 'https://status.anthropic.com',
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    accent: '#10a37f',
    usageUrl: 'https://chatgpt.com/#settings',
    statusUrl: 'https://status.openai.com',
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    accent: '#111111',
    usageUrl: 'https://cursor.com/dashboard',
    statusUrl: 'https://status.cursor.com',
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    accent: '#111111',
    usageUrl: 'https://grok.com/?_s=usage',
    statusUrl: 'https://status.x.ai',
  },
  'ollama-cloud': {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    accent: '#111111',
    usageUrl: 'https://ollama.com',
    statusUrl: 'https://status.ollama.com',
  },
}
