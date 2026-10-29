import type { CredentialStore, ProviderAccess } from '../credentials.ts'
import type { FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot, WindowReport } from '../snapshot.ts'

export type UsageFields = Pick<
  ProviderSnapshot,
  'plan' | 'remaining' | 'extra' | 'extraNote' | 'cost' | 'note'
> & {
  windows: WindowReport[]
}

export interface ProviderAdapter {
  identity: ProviderIdentity
  pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields>
  /** Ask the Provider's own CLI to renew credentials after its pull was rejected. */
  renew?(store: CredentialStore): Promise<ProviderAccess | undefined>
}
