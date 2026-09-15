export interface FetchLike {
  (url: string, init: RequestInit): Promise<Response>
}

export class HttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`HTTP ${String(status)}`)
    this.status = status
  }
}

const TIMEOUT_MS = 15_000

export async function getJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(response.status)
  }
  return await response.json()
}

export async function getJsonOptional(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<unknown | undefined> {
  try {
    return await getJson(fetchImpl, url, headers)
  } catch {
    return undefined
  }
}
