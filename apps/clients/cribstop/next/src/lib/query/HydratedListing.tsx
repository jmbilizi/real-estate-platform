import type { ReactNode } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import type { ListingDetailView } from '@/lib/api/listings';
import { getQueryClient } from './query-client';
import { listingKeys } from './keys';

/**
 * Hands a listing the server already loaded to the client cache, so the detail query starts fresh
 * and makes no request after hydration.
 *
 * Server component. The client is new for each request, and the data is public listing detail.
 * Never put per-user data here: a cached page would show it to every visitor.
 * The listing arrives only through this boundary, never as a second prop, so the payload carries
 * it once. Nothing on the server renders from the query.
 */
export default function HydratedListing({
  listing,
  children,
}: {
  listing: ListingDetailView;
  children: ReactNode;
}) {
  const client = getQueryClient();
  client.setQueryData(listingKeys.detail(listing.id), listing);
  return <HydrationBoundary state={dehydrate(client)}>{children}</HydrationBoundary>;
}
