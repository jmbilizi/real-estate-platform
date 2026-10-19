'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PROPERTY_TYPES } from '@cribstop/property-contracts';
import type { ListingsBatchResult, ListingsEnvelope } from '@cribstop/property-contracts';
import {
  ListingsApiError,
  type ListingsBatchQuery,
  type ListingSearchQuery,
  searchListingsBatch,
} from '@/lib/api/listings';
import { searchKeys } from '@/lib/query/keys';

/**
 * One request for the home page rows (#960). The row queries live here, once. A row component and
 * the batch both read them, so the batch always asks for exactly what a row shows.
 */

export type HomeSide = 'sale' | 'rent';
export type HomePlace = { city: string; state: string } | null;
export type PriceSort = 'price-asc' | 'price-desc';

/** Small — a carousel shows a handful of cards, never a full results page. */
export const CAROUSEL_PAGE_SIZE = 8;

/** Rows that share a side and a target fetch this many extra cards, so a card an earlier row
 *  already shows can drop out and the row still fills (#873). */
export const DEDUPE_PAGE_SIZE = CAROUSEL_PAGE_SIZE + 7;

/** Data-quality floors, not budget caps. The feed holds placeholder prices (sale $500, rent $0)
 *  that would head the low-to-high rows. Real low prices sit above these (#478). */
export const PRICE_FLOOR: Record<HomeSide, number> = { sale: 5_000, rent: 200 };

/** The sale row shows homes, not lots: `Land` at $999 headed the low-to-high row. */
export const SALE_HOME_TYPES = PROPERTY_TYPES.filter((type) => type !== 'Land');

const scopeOf = (place: HomePlace) => (place ? { city: place.city, state: place.state } : {});

/** The search each home row runs. A targeted row adds its own place scope. */
export const homeRowQuery = {
  nearYou: (side: HomeSide, place: HomePlace): ListingSearchQuery => ({
    listingType: side,
    city: place?.city,
    state: place?.state,
    sort: 'newest',
    pageSize: DEDUPE_PAGE_SIZE,
  }),
  justListed: (side: HomeSide): ListingSearchQuery => ({
    sort: 'newly-listed',
    listingType: side,
    pageSize: DEDUPE_PAGE_SIZE,
  }),
  comingSoon: (side: HomeSide, place: HomePlace): ListingSearchQuery => ({
    status: ['Coming Soon'],
    sort: 'newest',
    listingType: side,
    pageSize: CAROUSEL_PAGE_SIZE,
    city: place?.city,
    state: place?.state,
  }),
  priceDrops: (): ListingSearchQuery => ({
    priceReduced: true,
    sort: 'newly-listed',
    listingType: 'sale',
    pageSize: DEDUPE_PAGE_SIZE,
  }),
  priceSort: (side: HomeSide, sort: PriceSort, place: HomePlace): ListingSearchQuery => ({
    listingType: side,
    sort,
    minPrice: PRICE_FLOOR[side],
    ...(side === 'sale' ? { propertyType: SALE_HOME_TYPES } : {}),
    pageSize: CAROUSEL_PAGE_SIZE,
    city: place?.city,
    state: place?.state,
  }),
};

/** The id a row uses in the batch. A row that reads another sort than the default has none. */
export const homeBatchId = {
  nearYou: (side: HomeSide) => `near-you-${side}`,
  justListed: (side: HomeSide) => `just-listed-${side}`,
  comingSoon: (side: HomeSide) => `coming-soon-${side}`,
  priceDrops: 'price-drops',
  priceSort: (side: HomeSide) => `price-sort-${side}`,
} as const;

/** Rows a row shows without a click. A visitor who sorts a row differently gets its own request. */
export const DEFAULT_PRICE_SORT: PriceSort = 'price-asc';

/**
 * The batch for one place. The rows with no place scope still ask, so a visitor with no place sees
 * the platform-wide rows. "Near you" needs a place, so it has no row without one. Only the rows
 * that widen today (newest and price drops) widen here.
 */
export function homeBatchRows(place: HomePlace): ListingsBatchQuery[] {
  const sides: HomeSide[] = ['sale', 'rent'];
  const rows: ListingsBatchQuery[] = [];
  const add = (id: string, query: ListingSearchQuery, widen = false) =>
    rows.push({ id, query: { ...query, skipTotal: true }, widen: widen && place !== null });

  if (place) {
    for (const side of sides) add(homeBatchId.nearYou(side), homeRowQuery.nearYou(side, place));
  }
  for (const side of sides) {
    add(
      homeBatchId.justListed(side),
      { ...homeRowQuery.justListed(side), ...scopeOf(place) },
      true,
    );
  }
  for (const side of sides) {
    add(homeBatchId.comingSoon(side), homeRowQuery.comingSoon(side, place));
  }
  add(homeBatchId.priceDrops, { ...homeRowQuery.priceDrops(), ...scopeOf(place) }, true);
  for (const side of sides) {
    add(homeBatchId.priceSort(side), homeRowQuery.priceSort(side, DEFAULT_PRICE_SORT, place));
  }
  return rows;
}

/** What a row learns from the batch. `null` from the hook means the row runs its own search. */
export type HomeBatchRow =
  | { kind: 'pending' }
  | { kind: 'failed'; refetch: () => void }
  | {
      kind: 'ready';
      result: ListingsEnvelope;
      scope: { city?: string; state?: string };
    };

type BatchState =
  | { status: 'pending' }
  | { status: 'unsupported' }
  | { status: 'failed'; refetch: () => void }
  | { status: 'ready'; rows: Map<string, ListingsBatchResult>; refetch: () => void };

const HomeBatchContext = createContext<BatchState | null>(null);

/**
 * An older gateway or service has no batch route and answers 404. The page then runs one search
 * per row, as it did before. Any other failure retries with backoff, as every row read does (#955).
 */
function isUnsupported(error: unknown): boolean {
  return error instanceof ListingsApiError && (error.status === 404 || error.status === 405);
}

export function HomeBatchProvider({
  place,
  placeLoading,
  enabled = true,
  children,
}: {
  place: HomePlace;
  placeLoading: boolean;
  /** False while the page shows no search row, so the page sends no batch. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const city = place?.city;
  const state = place?.state;
  const query = useQuery({
    // The rows follow from the place alone, so the place is the whole key.
    queryKey: searchKeys.homeBatch(`${city ?? ''}|${state ?? ''}`),
    queryFn: ({ signal }) =>
      searchListingsBatch(homeBatchRows(city && state ? { city, state } : null), signal),
    enabled: enabled && !placeLoading,
  });
  const { data, error, isError } = query;
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  const value = useMemo<BatchState>(() => {
    if (data) {
      return { status: 'ready', rows: new Map(data.rows.map((r) => [r.id, r])), refetch: retry };
    }
    if (isError) {
      return isUnsupported(error)
        ? { status: 'unsupported' }
        : { status: 'failed', refetch: retry };
    }
    return { status: 'pending' };
  }, [data, isError, error, retry]);

  return <HomeBatchContext.Provider value={value}>{children}</HomeBatchContext.Provider>;
}

/**
 * The batch answer for one row. `null` when the row must run its own search: no batch around the
 * row, an unsupported batch, or a row the batch does not carry. A refetch that fails keeps the
 * last answer, so a row keeps its cards (#955).
 */
export function useHomeBatchRow(id: string | undefined): HomeBatchRow | null {
  const batch = useContext(HomeBatchContext);
  if (!id || !batch || batch.status === 'unsupported') return null;
  if (batch.status === 'pending') return { kind: 'pending' };
  if (batch.status === 'failed') return { kind: 'failed', refetch: batch.refetch };
  const row = batch.rows.get(id);
  if (!row) return null;
  if ('error' in row) return { kind: 'failed', refetch: batch.refetch };
  return { kind: 'ready', result: row.result, scope: row.scope };
}
