import type { ProviderAccess } from '../credentials.ts'
import type { FetchLike } from '../http.ts'
import type { ProviderIdentity, ProviderSnapshot } from '../snapshot.ts'

export type UsageFields = Pick<
  ProviderSnapshot,
  'plan' | 'remaining' | 'windows' | 'extra' | 'extraNote' | 'cost' | 'note'
>

export interface ProviderAdapter {
  identity: ProviderIdentity
  pull(access: ProviderAccess, fetchImpl: FetchLike, now: number): Promise<UsageFields>
}
