'use client';

import type { ListingDetailView } from './listings';

/**
 * A browser-session cache of listing **details**.
 *
 * The two listing payloads are deliberately different sizes. A search result is a card row — the
 * fields a tile shows, and `primaryMedia` alone rather than the whole gallery — because a results
 * page renders twenty of them and must stay cheap. The full graph (every photo, the description,
 * open houses, attribution) is fetched only when someone opens a listing, which is the point at
 * which it is worth paying for.
 *
 * That trade only works if opening the same listing twice costs once. Without this, closing a modal
 * and reopening it — or scrolling back to a card already looked at — re-fetched the entire detail
 * every time, which turns the cheap-list/rich-detail split into a worse deal than just sending
 * everything up front.
 *
 * **This is not the platform's caching layer, and is not trying to be.** Caching listings belongs
 * in the Property API, on Redis, where it is shared by every visitor and invalidated by writes
 * (#82). What that cannot do is remove the request: a warm server cache still costs a round trip
 * through the gateway. This removes the round trip, for one tab, for the few minutes someone spends
 * comparing homes. The two are complementary, and this is the smaller of them.
 *
 * `app/api/_lib/listings-gateway.ts` now forwards the service's `Cache-Control: public, max-age=60`
 * and its ETag, so the browser's own HTTP cache already absorbs a repeat detail request inside that
 * window and this saves no bytes there. What it still saves is the *asynchrony*: an HTTP cache hit
 * is a fetch that resolves in a microtask, which is a render through `status: 'loading'` and a
 * skeleton before the listing appears. Reading synchronously during the first render is what makes
 * reopening a listing show the listing, not a flash of skeleton and then the listing.
 *
 * Deliberately module-level and client-only. It is per-tab, dies with the page, and never sees the
 * server, where a module-level Map would be shared across every visitor and grow without bound.
 */

/**
 * How long a cached detail may be served before it is fetched again.
 *
 * A listing is not immutable — status, price and open houses all change — so this is short enough
 * that a long-lived tab cannot show a home as active hours after it went under contract, and long
 * enough to cover the browse pattern it exists for (open, close, reopen, compare).
 */
const TTL_MS = 5 * 60_000;

/**
 * How many details may be held at once.
 *
 * The TTL alone does not bound this. Entries expire only when they are *read* — nothing sweeps —
 * so a session that opens a hundred listings without reopening any of them holds a hundred full
 * detail graphs, gallery media and all, for as long as the tab lives. That is the browse pattern
 * this cache is least useful for and costs the most on.
 *
 * Thirty is comfortably past the point where someone is still comparing rather than browsing, which
 * is the pattern the cache exists to serve. Eviction is least-recently-*stored*, which `Map` gives
 * for free: iteration order is insertion order, so the oldest key is the first one.
 */
const MAX_ENTRIES = 30;

const cache = new Map<string, { listing: ListingDetailView; storedAt: number }>();

/** The cached detail for `id`, or `undefined` if absent or past its TTL. */
export function readCachedListing(id: string): ListingDetailView | undefined {
  const entry = cache.get(id);
  if (!entry) return undefined;

  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(id);
    return undefined;
  }

  return entry.listing;
}

/** Records a freshly loaded detail. Keyed on the listing's own id, which is what the URL carries. */
export function cacheListing(listing: ListingDetailView): void {
  // Re-storing an existing id must move it to the back of the eviction order, and `Map.set` alone
  // does not — it keeps the original insertion position — so delete first.
  cache.delete(listing.id);
  cache.set(listing.id, { listing, storedAt: Date.now() });

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Empties the cache. For tests, and for anything that invalidates listing data wholesale. */
export function clearListingCache(): void {
  cache.clear();
}
