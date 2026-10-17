import type { ReactNode } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ListingsEnvelope } from '@cribstop/property-contracts';
import type { ListingSearchQuery } from '@/lib/api/listings';
import { getQueryClient } from './query-client';
import { searchResultsOptions } from './search';

/**
 * Hands the first page of a search the server already loaded to the client cache, so the results
 * query starts fresh and makes no request after hydration.
 *
 * Server component. The client is new for each request, and the data is public listing data.
 * Never put per-user data here: a cached page would show it to every visitor.
 * The page arrives only through this boundary, never as a second prop, so the payload carries it
 * once. The key matches the request the client builds from the same URL and place.
 */
export default function HydratedSearch({
  request,
  results,
  children,
}: {
  request: ListingSearchQuery;
  results: ListingsEnvelope;
  children: ReactNode;
}) {
  const client = getQueryClient();
  client.setQueryData(searchResultsOptions(request).queryKey, results);
  return <HydrationBoundary state={dehydrate(client)}>{children}</HydrationBoundary>;
}
