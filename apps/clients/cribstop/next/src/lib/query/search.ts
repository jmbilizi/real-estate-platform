import { keepPreviousData, queryOptions, type UseQueryOptions } from '@tanstack/react-query';
import type {
  BrokersResponse,
  ListingsEnvelope,
  MapBounds,
  NeighborhoodsResponse,
  ZipsResponse,
} from '@cribstop/property-contracts';
import {
  getBrokerGroups,
  getListingsMeta,
  getNeighborhoodGroups,
  getNeighborhoods,
  getZipGroups,
  type ListingSearchQuery,
  searchListings,
} from '@/lib/api/listings';
import { formatBounds } from '@/lib/map-bounds';
import { searchKeys } from './keys';

/**
 * The request as one string, with keys sorted. Two queries that send the same request share a
 * key whatever their property order. Absent and empty values drop out, as in the request URL.
 * It does not call `toSearchParams`, so a spec that mocks `lib/api/listings` still gets a key.
 */
export function requestKey(query: object): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'bounds' && typeof value === 'object' && !Array.isArray(value)) {
      pairs.push(`${key}=${formatBounds(value as MapBounds)}`);
    } else if (Array.isArray(value)) {
      for (const entry of value.map(String).sort()) pairs.push(`${key}=${entry}`);
    } else {
      pairs.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
  }
  return pairs.join('&');
}

/** A server-rendered page stays fresh this long, so hydration does not fetch it again. */
const SEED_STALE_MS = 60_000;

type GroupQuery = Parameters<typeof getZipGroups>[0];

/**
 * One page of results. `keepPrevious` keeps the last page on screen while the next one loads.
 * `initialData` seeds the cache from the server render, so the first paint holds the cards.
 */
export function searchResultsOptions(
  query: ListingSearchQuery,
  {
    initialData,
    keepPrevious = true,
  }: { initialData?: ListingsEnvelope; keepPrevious?: boolean } = {},
) {
  return queryOptions({
    queryKey: searchKeys.results(requestKey(query)),
    queryFn: ({ signal }) => searchListings(query, signal),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
    ...(initialData
      ? { initialData, initialDataUpdatedAt: Date.now(), staleTime: SEED_STALE_MS }
      : {}),
  });
}

export function neighborhoodGroupsOptions(
  query: GroupQuery,
): UseQueryOptions<NeighborhoodsResponse> {
  return {
    queryKey: searchKeys.neighborhoods(requestKey(query)),
    queryFn: ({ signal }) => getNeighborhoodGroups(query, signal),
  };
}

/** The home page's neighborhood tiles. They share the neighborhood key with the search groups. */
export function neighborhoodsOptions(query: Parameters<typeof getNeighborhoods>[0]) {
  return queryOptions({
    queryKey: searchKeys.neighborhoods(requestKey(query)),
    queryFn: ({ signal }) => getNeighborhoods(query, signal),
  });
}

export function zipGroupsOptions(query: GroupQuery): UseQueryOptions<ZipsResponse> {
  return {
    queryKey: searchKeys.zips(requestKey(query)),
    queryFn: ({ signal }) => getZipGroups(query, signal),
  };
}

export function brokerGroupsOptions(query: GroupQuery): UseQueryOptions<BrokersResponse> {
  return {
    queryKey: searchKeys.brokers(requestKey(query)),
    queryFn: ({ signal }) => getBrokerGroups(query, signal),
  };
}

export function listingsMetaOptions() {
  return queryOptions({
    queryKey: searchKeys.meta(),
    queryFn: ({ signal }) => getListingsMeta(signal),
  });
}
