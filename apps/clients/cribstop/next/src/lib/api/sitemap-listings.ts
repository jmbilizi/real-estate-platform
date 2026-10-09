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
 */

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; listings: ListingCardRow[] } | null = null;
let inflight: Promise<ListingCardRow[]> | null = null;

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
    rows.push(...data.results.filter(isSitemapEligible));
    if (page >= data.pageCount) break;
  }
  return rows;
}

async function walkFeed(): Promise<ListingCardRow[]> {
  // Sold listings are a listing type of their own and stay out.
  const listingTypes = LISTING_TYPES.filter((type) => type !== 'sold');
  const slices = await Promise.all(
    listingTypes.flatMap((listingType) =>
      PROPERTY_TYPES.map((propertyType) => walkSlice(listingType, propertyType)),
    ),
  );
  // A failed slice keeps the last complete snapshot rather than publishing a partial sitemap.
  if (slices.some((slice) => slice === null)) {
    if (cached) return cached.listings;
    throw new Error('Sitemap listing feed is unavailable.');
  }
  const byId = new Map<string, ListingCardRow>();
  for (const slice of slices) for (const card of slice ?? []) byId.set(card.id, card);
  const listings = [...byId.values()];
  cached = { at: Date.now(), listings };
  return listings;
}

/** Eligible listings, deduplicated by id, cached for ten minutes and shared by concurrent callers. */
export function loadSitemapListings(): Promise<ListingCardRow[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.listings);
  inflight ??= walkFeed().finally(() => {
    inflight = null;
  });
  return inflight;
}
