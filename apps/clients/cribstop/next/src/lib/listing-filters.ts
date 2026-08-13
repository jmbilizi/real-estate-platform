import { AMENITIES, LISTING_TYPES, PROPERTY_TYPES } from '@cribstop/property-contracts';
import type { SearchFilters } from '@/lib/types';

const SORT_VALUES = ['recommended', 'newest', 'price-asc', 'price-desc'] as const;

/**
 * URL ↔ filter-state translation and the Lot/Land interlock.
 *
 * Filter semantics used to live in `lib/filters.ts` as a client-side `applyFilters` pipeline over
 * the mock array. That file is gone: search is now server-side, and keeping a second
 * implementation of the same predicates would guarantee the two drift.
 */

/** True when the user has narrowed to parcels and nothing else. */
export function isLandOnly(filters: SearchFilters): boolean {
  return filters.propertyType === 'Land';
}

/**
 * The Lot/Land interlock.
 *
 * Dwelling predicates exclude parcels server-side — a NULL `beds` fails a `beds >= N` predicate —
 * so a stale `beds=2` sitting alongside the Lot/Land chip returns zero results with no explanation.
 * That is the trap the incumbents never fixed.
 *
 * The fix is to **clear the values**, not to drop them from the request: the API applies exactly
 * what it is asked and echoes `appliedFilters` back for reconciliation, so silently sending
 * something other than what the UI shows would make the two disagree. Clearing here is what the
 * disabled controls display, which keeps the UI and the request the same statement.
 */
export function applyLandInterlock(filters: SearchFilters): SearchFilters {
  if (!isLandOnly(filters)) return filters;
  if (filters.beds === undefined && filters.baths === undefined && filters.minSqft === undefined) {
    return filters;
  }

  const next = { ...filters };
  delete next.beds;
  delete next.baths;
  delete next.minSqft;
  return next;
}

/**
 * Parses filter state out of the URL.
 *
 * `q` and `type` are kept as the query-string spellings for `query` and `listingType` because the
 * search bar already builds links with them and existing links must keep working; everything else
 * uses the contract's own parameter name.
 *
 * Note what is absent: there is no occupancy parameter to parse, because #34's recorded decision
 * removed that panel and the contract never had a field for it.
 */
export function parseFiltersFromSearchParams(params: URLSearchParams): SearchFilters {
  const filters: SearchFilters = {};

  const str = (key: string) => params.get(key)?.trim() || undefined;
  const num = (key: string) => {
    const raw = str(key);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const bool = (key: string) => (params.get(key) === 'true' ? true : undefined);

  filters.query = str('q');
  filters.zip = str('zip');
  filters.street = str('street');
  filters.neighborhood = str('neighborhood');

  /**
   * Enum parameters are validated against the contract's own value sets before being forwarded.
   *
   * The request is strict-parsed server-side, so an unrecognised value is a 400 — and a 400 we
   * manufactured from a mangled URL is indistinguishable, to the user, from the API being broken.
   * Dropping a value the contract does not define degrades to a wider search, which is a page the
   * user can act on. Genuine API 400s (a rejected filter combination, the result-window bound in
   * #65) still surface as an error state; this only stops us generating our own.
   */
  const oneOf = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const raw = str(key);
    return raw !== undefined && (allowed as readonly string[]).includes(raw)
      ? (raw as T)
      : undefined;
  };

  const listingType = str('type');
  if (listingType && listingType !== 'all') {
    filters.listingType = oneOf('type', LISTING_TYPES);
  }

  /**
   * A single value, never a list. The search bar used to emit `propertyType=Condo,Townhome` from
   * multi-select checkboxes; the contract's `propertyType` is one enum value, so a comma-joined
   * value fails this check and is dropped rather than 400ing the page. The control itself is now
   * single-select (see `CompactSearchBar`), so the UI cannot produce one — this is the guard for a
   * hand-edited or bookmarked URL that still carries the old shape.
   */
  const propertyType = str('propertyType');
  if (propertyType && propertyType !== 'all') {
    filters.propertyType = oneOf('propertyType', PROPERTY_TYPES);
  }

  filters.minPrice = num('minPrice');
  filters.maxPrice = num('maxPrice');
  filters.beds = num('beds');
  filters.baths = num('baths');
  filters.minSqft = num('minSqft');

  filters.openHouse = bool('openHouse');
  filters.newConstruction = bool('newConstruction');
  filters.waterfront = bool('waterfront');
  filters.petFriendly = bool('petFriendly');

  // `amenities` is the one genuinely repeatable parameter, against a closed 15-value set.
  const amenities = params
    .getAll('amenities')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value): value is (typeof AMENITIES)[number] =>
      (AMENITIES as readonly string[]).includes(value),
    );
  if (amenities.length > 0) {
    filters.amenities = Array.from(new Set(amenities));
  }

  filters.sort = oneOf('sort', SORT_VALUES);

  // Strip the keys that resolved to undefined so `appliedFilters` reconciliation and the active
  // filter count both see an absent filter rather than a present-but-empty one.
  for (const key of Object.keys(filters) as (keyof SearchFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }

  return applyLandInterlock(filters);
}

/** The 1-based page from the URL, floored at 1 so a hand-edited `?page=0` cannot 400. */
export function parsePageFromSearchParams(params: URLSearchParams): number {
  const parsed = Number(params.get('page'));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}
