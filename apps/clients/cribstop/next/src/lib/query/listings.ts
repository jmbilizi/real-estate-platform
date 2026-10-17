import { queryOptions } from '@tanstack/react-query';
import { getListing, searchListings } from '@/lib/api/listings';
import type { ListingDetailView } from '@/lib/api/listings';
import { listingKeys, nearbyKeys } from './keys';

/** A hover prefetch skips a listing fetched in the last 30 s. */
export const PREFETCH_STALE_TIME_MS = 30_000;

/** A cached detail counts as fresh for 60 s, so a reopen or a server-seeded listing needs no request. */
const DETAIL_STALE_TIME_MS = 60_000;

/**
 * The full detail of one listing. A search card is a partial row, so it never seeds this key:
 * the card only sizes the loading skeleton (`layoutRow` on `ListingDetailModal`).
 */
export function listingDetailOptions(id: string) {
  return queryOptions({
    queryKey: listingKeys.detail(id),
    queryFn: ({ signal }) => getListing(id, signal),
    staleTime: DETAIL_STALE_TIME_MS,
  });
}

/** Half the side of the nearby search square, in degrees. Matches the property page API (~2 km). */
const NEARBY_HALF_SIDE = 0.02;

type NearbySubject = Pick<
  ListingDetailView,
  'id' | 'latitude' | 'longitude' | 'city' | 'state' | 'listingType'
>;

/**
 * Same query as the property page API: active homes of the same offer (sale or rent) in a square
 * around this one, else in its city. A sold listing compares against live inventory.
 */
export function nearbyListingsOptions(listing: NearbySubject) {
  const { id, latitude: lat, longitude: lng, city, state, listingType } = listing;
  const d = NEARBY_HALF_SIDE;
  const place =
    lat !== null && lng !== null
      ? {
          boundary: JSON.stringify({
            type: 'Polygon',
            coordinates: [
              [
                [lng - d, lat - d],
                [lng + d, lat - d],
                [lng + d, lat + d],
                [lng - d, lat + d],
                [lng - d, lat - d],
              ],
            ],
          }),
        }
      : { city, state };
  const request = {
    ...place,
    listingType: listingType === 'rent' ? ('rent' as const) : ('sale' as const),
    status: ['Active' as const],
    sort: 'newest' as const,
    pageSize: 9,
  };
  return queryOptions({
    queryKey: [...nearbyKeys.forListing(id), request],
    queryFn: async ({ signal }) => {
      const envelope = await searchListings(request, signal);
      return envelope.results.filter((row) => row.id !== id);
    },
  });
}
