import { keepPreviousData, queryOptions, type UseQueryOptions } from '@tanstack/react-query';
import type {
  BrokersResponse,
  ListingsEnvelope,
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
  toSearchParams,
} from '@/lib/api/listings';
import { searchKeys } from './keys';

/**
 * The request as one string. It uses the serializer that builds the URL, so two queries that send
 * the same request share a key whatever their property order. Absent and empty values drop out.
 */
export function requestKey(query: object): string {
  return [...toSearchParams(query as ListingSearchQuery)]
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

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
    ...(initialData ? { initialData, initialDataUpdatedAt: Date.now() } : {}),
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
