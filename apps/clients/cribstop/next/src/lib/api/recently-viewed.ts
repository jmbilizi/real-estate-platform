/**
 * Records that the signed-in visitor opened a listing (#982). Fire and forget: a failure is
 * silent, nothing retries, and the page never waits for the answer.
 */
export function recordRecentlyViewed(listingId: string): void {
  try {
    void fetch('/api/account/recently-viewed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // A synchronous failure is also silent.
  }
}

/** The listing ids the signed-in visitor viewed, newest first (#366). Rejects on any failure. */
export async function getRecentlyViewedIds(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch('/api/account/recently-viewed', {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Recently viewed answered ${res.status}`);
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.listingIds)
    ? body.listingIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
}
