import {
  LISTING_TYPES,
  type ListingCardRow,
  listingsEnvelopeSchema,
  maxReachablePage,
  PAGE_SIZE_MAX,
  PROPERTY_TYPES,
} from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { isSitemapEligible } from '@/lib/site-indexing';

/**
 * Server-only. Reads every consumer-visible listing from the Property API through the gateway.
 *
 * One query reaches at most `maxReachablePage(100)` pages, so the walk splits by listing type and
 * property type. Each slice stays inside the window, and the union covers the full feed.
 *
 * The same walk gives the place tally (#845): the cities that have Active listings, counted the way
 * a city page counts them. No market name is listed in code. The feed names the places.
 */

/** One city page candidate: a city, a state and the path segment, with its Active listing count. */
export type SitemapPlace = {
  readonly city: string;
  readonly state: string;
  readonly segment: 'homes-for-sale' | 'homes-for-rent';
  readonly activeCount: number;
  /** The newest `lastUpdated` among the place's Active listings. ISO 8601. */
  readonly lastUpdated: string;
};

export type SitemapFeed = {
  readonly listings: ListingCardRow[];
  readonly places: SitemapPlace[];
};

const TTL_MS = 10 * 60 * 1000;
/** After a failed refresh, the stale feed serves this much longer before the next try. */
const RETRY_AFTER_MS = 60 * 1000;
let cached: { at: number; feed: SitemapFeed } | null = null;
let inflight: Promise<SitemapFeed> | null = null;

async function fetchPage(
  listingType: string,
  propertyType: string,
  page: number,
): Promise<{ results: ListingCardRow[]; pageCount: number } | null> {
  const query = new URLSearchParams({
    listingType,
    propertyType,
    sort: 'newest',
    page: String(page),
    pageSize: String(PAGE_SIZE_MAX),
  });
  const res = await fetchGateway(`/property/listings?${query}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).catch(() => null);
  if (!res?.ok) return null;
  const parsed = listingsEnvelopeSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Walks one slice. Returns null when any page fails, so a partial slice is never trusted. */
async function walkSlice(
  listingType: string,
  propertyType: string,
): Promise<ListingCardRow[] | null> {
  const rows: ListingCardRow[] = [];
  const lastPage = maxReachablePage(PAGE_SIZE_MAX);
  for (let page = 1; page <= lastPage; page += 1) {
    const data = await fetchPage(listingType, propertyType, page);
    if (!data) return null;
    rows.push(...data.results);
    if (page >= data.pageCount) break;
  }
  return rows;
}

/**
 * Counts Active listings per city and path segment, as a city page counts them: status Active and
 * the page's own listing type. A suppressed address or a sample row still counts, because the page
 * count includes them. The count decides only whether the page is an index candidate.
 */
export function tallyPlaces(rows: readonly ListingCardRow[]): SitemapPlace[] {
  const tally = new Map<string, SitemapPlace>();
  for (const row of rows) {
    if (row.status !== 'Active' || (row.listingType !== 'sale' && row.listingType !== 'rent')) {
      continue;
    }
    const segment = row.listingType === 'rent' ? 'homes-for-rent' : 'homes-for-sale';
    const key = `${row.state}\u0000${row.city}\u0000${segment}`;
    const known = tally.get(key);
    tally.set(key, {
      city: row.city,
      state: row.state,
      segment,
      activeCount: (known?.activeCount ?? 0) + 1,
      lastUpdated:
        known && Date.parse(known.lastUpdated) >= Date.parse(row.lastUpdated)
          ? known.lastUpdated
          : row.lastUpdated,
    });
  }
  return [...tally.values()].sort(
    (a, b) =>
      a.state.localeCompare(b.state) ||
      a.city.localeCompare(b.city) ||
      a.segment.localeCompare(b.segment),
  );
}

async function walkFeed(): Promise<SitemapFeed> {
  // Sold listings are a listing type of their own and stay out.
  const listingTypes = LISTING_TYPES.filter((type) => type !== 'sold');
  const slices = await Promise.all(
    listingTypes.flatMap((listingType) =>
      PROPERTY_TYPES.map((propertyType) => walkSlice(listingType, propertyType)),
    ),
  );
  // A failed slice keeps the last complete snapshot rather than publishing a partial sitemap.
  if (slices.some((slice) => slice === null)) {
    if (cached) {
      cached.at = Date.now() - TTL_MS + RETRY_AFTER_MS;
      return cached.feed;
    }
    throw new Error('Sitemap listing feed is unavailable.');
  }
  const byId = new Map<string, ListingCardRow>();
  for (const slice of slices) for (const card of slice ?? []) byId.set(card.id, card);
  const rows = [...byId.values()];
  const feed = { listings: rows.filter(isSitemapEligible), places: tallyPlaces(rows) };
  cached = { at: Date.now(), feed };
  return feed;
}

/**
 * The feed, cached for ten minutes and shared by concurrent callers. An expired snapshot is served
 * at once while one refresh runs, so a crawler never waits on the full walk after the first one.
 */
export function loadSitemapFeed(): Promise<SitemapFeed> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.feed);
  inflight ??= walkFeed().finally(() => {
    inflight = null;
  });
  if (cached) {
    inflight.catch(() => undefined);
    return Promise.resolve(cached.feed);
  }
  return inflight;
}

/** Eligible listings, deduplicated by id. */
export async function loadSitemapListings(): Promise<ListingCardRow[]> {
  return (await loadSitemapFeed()).listings;
}
