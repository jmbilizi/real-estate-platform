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
