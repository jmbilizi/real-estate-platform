import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import type { MapBounds } from '@cribstop/property-contracts';
import { getListingCard, getListingsMap, type ListingSearchQuery } from '@/lib/api/listings';
import { formatBounds, roundBounds } from '@/lib/map-bounds';
import { mapKeys } from './keys';

/** The old card cache kept a card for 5 minutes (#549). */
export const MAP_CARD_STALE_MS = 5 * 60_000;

/**
 * Pins for one map view. The key holds the rounded bounds, so a pan under 11 meters reuses the
 * entry. `keepPreviousData` keeps the last pins on the map while the next view loads.
 */
export function viewportPinsOptions(filters: ListingSearchQuery, bounds: MapBounds) {
  const rounded = roundBounds(bounds);
  return queryOptions({
    queryKey: mapKeys.viewport(JSON.stringify(filters), formatBounds(rounded, 4)),
    queryFn: ({ signal }) => getListingsMap(filters, rounded, signal),
    placeholderData: keepPreviousData,
  });
}

/** One card for a map pin that the results page does not hold. */
export function mapCardOptions(id: string) {
  return queryOptions({
    queryKey: mapKeys.card(id),
    queryFn: ({ signal }) => getListingCard(id, signal),
    staleTime: MAP_CARD_STALE_MS,
  });
}
