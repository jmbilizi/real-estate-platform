import {
  AMENITIES,
  LISTING_TYPES,
  PROPERTY_TYPES,
  SORT_VALUES,
} from '@cribstop/property-contracts';
import type { SearchFilters } from '@/lib/types';

/**
 * URL ↔ filter-state translation and the Lot/Land interlock.
 *
 * Filter semantics used to live in `lib/filters.ts` as a client-side `applyFilters` pipeline over
 * the mock array. That file is gone: search is now server-side, and keeping a second
 * implementation of the same predicates would guarantee the two drift.
 */

/** True when the user has narrowed to parcels and nothing else. */
export function isLandOnly(filters: SearchFilters): boolean {
  return filters.propertyType?.length === 1 && filters.propertyType[0] === 'Land';
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

  /**
   * Numeric parameters are validated against the **contract's string forms**, not merely against
   * "is this a number".
   *
   * `minPrice`/`maxPrice`/`beds`/`minSqft` are `^\d+$` server-side and `baths` is `^\d+(\.5)?$`, so
   * `?minPrice=1.5`, `?minPrice=-500` and `?baths=1.7` are all 400s. Forwarding them would
   * manufacture exactly the error this function exists to avoid — see the note on `oneOf` below.
   *
   * **Zero is treated as absent, not as a filter.** `minPrice=0`, `beds=0` and `minSqft=0` are all
   * valid contract values that mean nothing as a narrowing — except `minSqft=0`, which is worse
   * than nothing: `v.sqft >= 0` excludes every row whose `sqft` is NULL, which is every parcel. A
   * zero would also count as no active filter in the badge and leave "Clear all" disabled, so it
   * would be narrowing the results with no control anywhere on the page able to remove it. The
   * stepper's own "Any" rung is 0, so this is also what keeps the two ends agreeing.
   */
  const int = (key: string) => {
    const raw = str(key);
    if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
    return Number(raw) || undefined;
  };
  const halfStep = (key: string) => {
    const raw = str(key);
    if (raw === undefined || !/^\d+(\.5)?$/.test(raw)) return undefined;
    return Number(raw) || undefined;
  };
  const bool = (key: string) => (params.get(key) === 'true' ? true : undefined);

  filters.query = str('q');
  filters.zip = str('zip');
  filters.street = str('street');
  filters.city = str('city');
  filters.neighborhood = str('neighborhood');

  // Exact two-letter code only — anything else is not a value the search bar or the contract's
  // own `state` filter would ever produce, so it is dropped rather than forwarded to a 400.
  const stateRaw = str('state');
  filters.state = stateRaw && /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : undefined;

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

  /**
   * `type` is the canonical spelling the search bar builds. `listingType` is accepted as an alias
   * because several in-app links and any bookmarked URL use it; without this, "Homes for Sale" in
   * the footer produced an unfiltered search that silently mixed sale and rent inventory.
   */
  const listingTypeRaw = str('type') ?? str('listingType');
  if (listingTypeRaw && listingTypeRaw !== 'all') {
    filters.listingType = (LISTING_TYPES as readonly string[]).includes(listingTypeRaw)
      ? (listingTypeRaw as SearchFilters['listingType'])
      : undefined;
  }

  // Repeated or comma-joined. Unknown values are dropped, and `all` means no narrowing.
  const propertyTypes = [
    ...new Set(
      params
        .getAll('propertyType')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter((value): value is (typeof PROPERTY_TYPES)[number] =>
          (PROPERTY_TYPES as readonly string[]).includes(value),
        ),
    ),
  ];
  if (propertyTypes.length > 0) filters.propertyType = propertyTypes;

  filters.minPrice = int('minPrice');
  filters.maxPrice = int('maxPrice');
  filters.beds = int('beds');
  filters.baths = halfStep('baths');
  filters.minSqft = int('minSqft');

  filters.openHouse = bool('openHouse');
  filters.newConstruction = bool('newConstruction');

  // `amenities` is the one genuinely repeatable parameter, against a closed 15-value set.
  const amenities = params
    .getAll('amenities')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value): value is (typeof AMENITIES)[number] =>
      (AMENITIES as readonly string[]).includes(value),
    );

  /**
   * `waterfront` and `petFriendly` are folded onto their amenity equivalents rather than kept as
   * separate filter state.
   *
   * They are not separate capabilities. In `property-service`'s `search-query.ts`,
   * `waterfront=true` compiles to `'Waterfront' = ANY(v.amenities)` and `petFriendly=true` to
   * `'Pet Friendly' = ANY(v.amenities)` — exactly what asking for those two amenities does. Two
   * parameters for one predicate means two controls for one thing in any honest UI, and a filter
   * surface that shows "Waterfront" twice, in two sections, where checking either changes the same
   * result set.
   *
   * Folding at the parse layer keeps the UI, the URL and the request one statement: every link
   * still minted with `?waterfront=true` (in-app links, bookmarks, anything predating this) keeps
   * working and now shows as applied in the modal, and the URL self-heals to the canonical
   * `?amenities=Waterfront` the next time filters are applied. Nothing is dropped from the request
   * — the same predicate is still asked for, under the parameter that has a control.
   */
  for (const [key, amenity] of [
    ['waterfront', 'Waterfront'],
    ['petFriendly', 'Pet Friendly'],
  ] as const) {
    if (bool(key) && !amenities.includes(amenity)) amenities.push(amenity);
  }

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

/**
 * Every query-string key `parseFiltersFromSearchParams` reads, including the two spellings it
 * accepts as aliases.
 *
 * Listed here so the serialiser can clear the whole filter vocabulary out of a URL before writing
 * the current one back. Without it a removed filter would persist: dropping `beds` from the modal
 * leaves `?beds=2` in the URL, the next parse puts it straight back, and the filter the user just
 * removed reappears on reload.
 */
const FILTER_PARAM_KEYS = [
  'q',
  'zip',
  'street',
  'city',
  'state',
  'neighborhood',
  'type',
  'listingType',
  'propertyType',
  'minPrice',
  'maxPrice',
  'beds',
  'baths',
  'minSqft',
  'openHouse',
  'newConstruction',
  'waterfront',
  'petFriendly',
  'amenities',
  'sort',
] as const;

/**
 * Writes a filter set back into a query string — the exact inverse of
 * `parseFiltersFromSearchParams`, so that `parse(serialise(f))` is `f`.
 *
 * The URL is the source of truth for a search: it is what the search page parses on load, what a
 * refresh restores, and what a user pastes to a partner or a spouse. Holding applied filters only
 * in React state made a filtered search unlinkable and unsurvivable — reloading the page showed a
 * different result set than the one on screen a moment earlier.
 *
 * `base` carries everything that is *not* a filter (`lat`/`lon` for the map, any campaign
 * parameter) through untouched; the filter vocabulary is cleared out of it first so a removed
 * filter is genuinely removed rather than resurrected by the next parse. `page` is always dropped:
 * a filter change means a different result set, and page 40 of the old one is not a position in
 * the new one — it is frequently past the end of it, which the API answers with a 400
 * (`result_window_exceeded`) rather than with homes.
 */
export function filtersToSearchParams(
  filters: SearchFilters,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of FILTER_PARAM_KEYS) params.delete(key);
  params.delete('page');

  // `0` is dropped along with `undefined` and `''`: it is not a narrowing, the parser reads it back
  // as absent, and writing it would put a filter in the URL that no control on the page can clear.
  const set = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '' || value === 0) return;
    params.set(key, String(value));
  };

  // `q` and `type` are the spellings the search bar builds and existing links carry; the parser's
  // `listingType` alias is deliberately never written, so a URL only ever holds one of the two.
  set('q', filters.query);
  set('zip', filters.zip);
  set('street', filters.street);
  set('city', filters.city);
  set('state', filters.state);
  set('neighborhood', filters.neighborhood);
  if (filters.listingType && filters.listingType !== 'all') set('type', filters.listingType);
  for (const type of filters.propertyType ?? []) params.append('propertyType', type);
  set('minPrice', filters.minPrice);
  set('maxPrice', filters.maxPrice);
  set('beds', filters.beds);
  set('baths', filters.baths);
  set('minSqft', filters.minSqft);

  // Only `true` is written. `?openHouse=false` parses back to `undefined` anyway, so writing it
  // would put a parameter in the URL that means nothing and reads as an active filter.
  if (filters.openHouse) params.set('openHouse', 'true');
  if (filters.newConstruction) params.set('newConstruction', 'true');

  // Repeated rather than comma-joined: both forms parse, and the repeated form is the one that
  // survives a value ever containing a comma.
  for (const amenity of filters.amenities ?? []) params.append('amenities', amenity);

  if (filters.sort && filters.sort !== 'recommended') set('sort', filters.sort);

  return params;
}

/** The 1-based page from the URL, floored at 1 so a hand-edited `?page=0` cannot 400. */
export function parsePageFromSearchParams(params: URLSearchParams): number {
  const parsed = Number(params.get('page'));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}
