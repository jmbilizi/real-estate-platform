import { cache } from 'react';
import { headers } from 'next/headers';
import {
  type ListingsEnvelope,
  type ListingsMeta,
  type SearchRequest,
} from '@cribstop/property-contracts';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { type CityStats, medianFromRanks } from '@/lib/city-summary';
import { parseQueryFilters } from '@/lib/search-place';
import type { SearchFilters } from '@/lib/types';
import { initialQueryFor } from './listings-initial';

/**
 * Active count and median list price of a place page (#842), read from the listings search the
 * page already uses. The service applies display and suppression rules to every row it returns, so
 * a figure never counts a suppressed row. A seller-suppressed price is null and `minPrice=1`
 * excludes it from the median.
 *
 * The median reads the middle row of the price-sorted set, one row per read. The reads share the
 * 60 second server cache of `read-cache.ts`. A service-side aggregate is the follow-up if the
 * reads cost too much.
 *
 * Returns `null` on any failure. The page then omits the figures and stays out of the index.
 *
 * **Server modules only.** It reads `API_GATEWAY_URL`.
 */
async function readSearch(query: string, clientIp: string | null): Promise<ListingsEnvelope> {
  const response = await proxyListingsRead('', query, { cache: true, clientIp });
  if (!response.ok) throw new Error(`Listings read failed: ${response.status}`);
  return (await response.json()) as ListingsEnvelope;
}

async function readMeta(clientIp: string | null): Promise<ListingsMeta | null> {
  try {
    const response = await proxyListingsRead('/meta', '', { cache: true, clientIp });
    return response.ok ? ((await response.json()) as ListingsMeta) : null;
  } catch {
    return null;
  }
}

const compute = cache(async (baseQuery: string): Promise<CityStats | null> => {
  try {
    const clientIp = clientIpOf(await headers());
    const base = new URLSearchParams(baseQuery);
    const withParams = (extra: Record<string, string>) => {
      const params = new URLSearchParams(base);
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
      return params.toString();
    };
    const [all, priced, meta] = await Promise.all([
      readSearch(withParams({ page: '1', pageSize: '1' }), clientIp),
      readSearch(withParams({ page: '1', pageSize: '1', minPrice: '1' }), clientIp),
      readMeta(clientIp),
    ]);
    const ranks = medianFromRanks(priced.total);
    let medianPrice: number | null = null;
    if (ranks) {
      const prices = await Promise.all(
        ranks.map(async (rank) => {
          const row = (
            await readSearch(withParams({ page: String(rank), pageSize: '1' }), clientIp)
          ).results[0];
          return row?.price ?? null;
        }),
      );
      medianPrice = prices.every((price): price is number => price !== null)
        ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length)
        : null;
    }
    return {
      activeCount: all.total,
      medianPrice,
      asOf: meta?.lastSyncedAt ?? meta?.dataUpdatedAt ?? new Date().toISOString(),
      sources: meta?.sources ?? [],
    };
  } catch {
    return null;
  }
});

/** The filters the grid shows, with status and sort fixed. Only Active listings count. */
export function loadCityStats(
  initialQuery: string,
  place: { readonly filters: SearchFilters },
): Promise<CityStats | null> {
  const request: Partial<SearchRequest> = {
    ...parseQueryFilters(new URLSearchParams(initialQuery), place),
    ...place.filters,
    status: ['Active'],
    sort: 'price-asc',
  };
  return compute(initialQueryFor(request));
}
