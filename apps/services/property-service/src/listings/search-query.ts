import {
  isDefaultStatusFilter,
  OFFICE_KEY_UNLISTED,
  type SearchRequest,
} from '@cribstop/property-contracts';
import { collapseCondition } from './collapse';
import { visibleListingTypesFor } from './sold-gate';

/**
 * Every sort is a total order: an `id` tiebreaker at the end, or paging repeats rows whenever two
 * listings tie on the primary key (a common case for `featured`/`last_updated`/`price`). No sort
 * carries a per-user signal, now or later — `recommended` is identical for every caller.
 */
export const SORT_ORDERS: Record<SearchRequest['sort'], string> = {
  recommended: 'v.featured DESC, v.last_updated DESC, v.id DESC',
  newest: 'v.last_updated DESC, v.id DESC',
  // #391. `listed_at` is nullable (a listing the feed carried no list date for), so a suppressed
  // or absent value sorts last, same reasoning as `price-desc` below.
  'newly-listed': 'v.listed_at DESC NULLS LAST, v.id DESC',
  // `price` is nullable in the contract (Bright's seller-directed field suppression can withhold
  // it). Postgres' implicit null ordering is NULLS LAST for ASC but NULLS FIRST for DESC, so
  // price-desc needs an explicit NULLS LAST or every price-suppressed row would float to the top.
  'price-asc': 'v.price ASC NULLS LAST, v.id DESC',
  'price-desc': 'v.price DESC NULLS LAST, v.id DESC',
};

export interface SearchQueryPlan {
  readonly where: string;
  readonly params: unknown[];
  readonly orderBy: string;
}

/**
 * The columns the scope filters (listing type, status, city, state) read. The same four conditions
 * run on `listing_search_v` here and on `listings` in the neighborhoods aggregate (#501), so both
 * read one definition. A column named here must exist, under that name, on the table the caller
 * queries.
 */
export interface ScopeColumns {
  readonly listingType: string;
  readonly status: string;
  readonly city: string;
  readonly state: string;
}

export const VIEW_SCOPE_COLUMNS: ScopeColumns = {
  listingType: 'v.listing_type',
  status: 'v.status',
  city: 'v.city',
  state: 'v.state',
};

/** The same columns on `listings`, where the status column is `consumer_status`. */
export const LISTINGS_SCOPE_COLUMNS: ScopeColumns = {
  listingType: 'v.listing_type',
  status: 'v.consumer_status',
  city: 'v.city',
  state: 'v.state',
};

type Bind = (value: unknown) => string;

export function listingTypeCondition(
  request: SearchRequest,
  bind: Bind,
  columns: ScopeColumns,
): string {
  return `${columns.listingType} = ANY(${bind([...visibleListingTypesFor(request.listingType)])})`;
}

/** `null` when the request has no status filter or the sold-tab rule below skips it. */
export function buildStatusCondition(
  request: SearchRequest,
  bind: Bind,
  columns: ScopeColumns,
): string | null {
  if (request.status.length === 0) {
    return null;
  }
  const skipForUnnarrowedSold =
    request.listingType === 'sold' && isDefaultStatusFilter(request.status);
  return skipForUnnarrowedSold ? null : `${columns.status} = ANY(${bind([...request.status])})`;
}

export function cityStateConditions(
  request: SearchRequest,
  bind: Bind,
  columns: ScopeColumns,
): string[] {
  const conditions: string[] = [];
  if (request.city) {
    conditions.push(`lower(${columns.city}) = lower(${bind(request.city)})`);
  }
  if (request.state) {
    conditions.push(`lower(${columns.state}) = lower(${bind(request.state)})`);
  }
  return conditions;
}

/** Listing type, status, city and state, in the order `buildSearchQuery` applies them. */
export function scopeConditions(
  request: SearchRequest,
  bind: Bind,
  columns: ScopeColumns,
): string[] {
  const typeCondition = listingTypeCondition(request, bind, columns);
  const statusCondition = buildStatusCondition(request, bind, columns);
  return [
    typeCondition,
    ...(statusCondition ? [statusCondition] : []),
    ...cityStateConditions(request, bind, columns),
  ];
}

/**
 * The bounding box of a validated `area` ring. The padding is a fixed margin plus a share of the
 * shape's size, because a geodesic edge bows poleward by an amount that grows with its length. The
 * contract caps the shape at 20 degrees across, where a quarter of the size covers the bow.
 */
export function areaBox(area: string): {
  south: number;
  north: number;
  west: number;
  east: number;
} {
  const ring = (JSON.parse(area) as { coordinates: [number, number][][] }).coordinates[0] ?? [];
  const lngs = ring.map((point) => point[0]);
  const lats = ring.map((point) => point[1]);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const pad = 0.01 + 0.25 * Math.max(east - west, north - south);
  return {
    west: Math.max(-180, west - pad),
    east: Math.min(180, east + pad),
    south: Math.max(-90, south - pad),
    north: Math.min(90, north + pad),
  };
}

const SEARCH_ONLY_KEYS = new Set(['sort', 'page', 'pageSize']);
const SCOPE_KEYS = new Set(['listingType', 'status', 'city', 'state']);

/**
 * Whether `request` carries no filter beyond the scope filters. A neighborhoods request that does
 * can run on `listings` without the view's joins. Any other key with a value (a new filter
 * included) answers `false`, which selects the view, the always correct path.
 */
export function isScopeOnlyRequest(request: SearchRequest): boolean {
  return Object.entries(request).every(([key, value]) => {
    if (SCOPE_KEYS.has(key) || SEARCH_ONLY_KEYS.has(key)) {
      return true;
    }
    return (
      value === undefined ||
      value === null ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
    );
  });
}

/**
 * Validated request -> `{ where, params, orderBy }`. One `if` per filter, one `bind()` per
 * placeholder. `where` defaults to `'TRUE'` when nothing is filtered (in practice the listing-type
 * condition below is always present, so that branch is a safety net rather than a reachable case).
 */
export function buildSearchQuery(request: SearchRequest): {
  where: string;
  params: unknown[];
  orderBy: string;
} {
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const conditions: string[] = [];

  // THE sold gate decides which listing types are visible (sold-gate.ts); this file only ever
  // binds its output, so tightening sold visibility is one edit there, never a second copy here.
  // `all` -> ['sale', 'rent'] (excludes sold); anything else -> that one type.
  conditions.push(listingTypeCondition(request, bind, VIEW_SCOPE_COLUMNS));

  if (request.propertyType.length > 0) {
    conditions.push(`v.property_type = ANY(${bind([...request.propertyType])})`);
  }

  // `v.status` is the view's alias of `consumer_status` (migration
  // 1785801600007_create-listing-search-view.js). It is never the raw MLS `status` code. The
  // view exposes that separately as `source_status`.
  //
  // The contract's `status` defaults to `['Active', 'Coming Soon']` (search-request.ts). This
  // condition is present on every ordinary search. It excludes Under Contract listings by
  // default with no special case here.
  //
  // Skipped for `listingType: 'sold'`, but ONLY while `status` is untouched. A sold row's
  // `v.status` can only ever be `Sold` (the generated `listing_type` column, migration
  // 1785801600003_create-listings.js). `Sold` is not a value `STATUS_FILTER_VALUES` accepts
  // (#33). ANDing the contract's default status in would zero the Sold tab permanently, for a
  // filter nobody touched. An EXPLICIT status alongside `listingType=sold` is a different
  // request — Active/Coming Soon/Pending asked for on top of Sold — and must still apply, which
  // correctly zeroes that specific combination rather than silently dropping the filter (the same
  // rule `query`/`zip`/`street` follow above: never drop a filter the caller actually asked for).
  const statusCondition = buildStatusCondition(request, bind, VIEW_SCOPE_COLUMNS);
  if (statusCondition) {
    conditions.push(statusCondition);
  }

  // `zip` is exact-or-prefix (today's `l.zip === zip || l.zip.startsWith(zip)`). `starts_with`
  // covers both without building a LIKE pattern, which would need to escape `%`/`_` from caller
  // input — a footgun this avoids entirely.
  if (request.zip) {
    conditions.push(`starts_with(v.zip, ${bind(request.zip)})`);
  }

  // `street` matches the MASKED `address`, never the raw `street_line`: filtering on the raw line
  // and getting a masked row back would be a confirmation oracle for a seller's suppressed
  // address, defeating the point of masking it in the response.
  if (request.street) {
    conditions.push(`strpos(lower(v.address), lower(${bind(request.street)})) > 0`);
  }

  // Case-insensitive EXACT equality, not substring — a place name, not a search term. Safe where
  // `street` needed care: `listing_search_v` masks `address`/`latitude`/`longitude` for a
  // seller-suppressed address but still publishes `city`/`state` unmasked, so this filter cannot
  // become a confirmation oracle for a withheld street address (#48 context). Indexed by migration
  // 023 (`idx_listings_city_lower`/`idx_listings_state_lower`) — the plain `idx_listings_city_state_zip`
  // btree cannot serve an expression predicate, same reasoning as `idx_listings_neighborhood_lower`.
  conditions.push(...cityStateConditions(request, bind, VIEW_SCOPE_COLUMNS));

  // Free-text search: title, address (masked), city, neighborhood, zip — never `description`,
  // which is third-party MLS remarks carrying a moderation state; making it searchable would be
  // keyword-based steering (PRD §6.3).
  //
  // A `query` shaped like "City, ST" never reaches this substring match: on-demand.ts's
  // `resolvedSearchRequest()` swaps it for an exact `city`/`state` match before the request gets
  // here, because no column stores "City, ST" as one string.
  //
  // Deliberately NOT wrapped in COALESCE(x, ''): `strpos(lower(NULL), q)` evaluates to NULL, and
  // SQL's three-valued OR treats `NULL OR TRUE` as TRUE while `NULL OR FALSE` is NULL — which
  // WHERE treats as not-matching. That is exactly the behaviour a NULL column should have here
  // (a masked address contributes nothing, never a false match), and it keeps every COALESCE out
  // of this file.
  // The parentheses are load-bearing, not cosmetic. `AND` binds tighter than `OR` in SQL, so an
  // unwrapped disjunction spliced into an AND-joined list silently reassociates to
  // `(listing_type AND zip AND title_match) OR address_match OR city_match OR ...` — and every
  // branch after the first then bypasses EVERY other filter, including the sold gate. A free-text
  // search would have returned sold listings under `listingType=all`. Any condition added here
  // that is internally a disjunction must be wrapped the same way.
  if (request.query) {
    const q = bind(request.query);
    conditions.push(
      `(${[
        `strpos(lower(v.title), lower(${q})) > 0`,
        `strpos(lower(v.address), lower(${q})) > 0`,
        `strpos(lower(v.city), lower(${q})) > 0`,
        `strpos(lower(v.neighborhood), lower(${q})) > 0`,
        `strpos(v.zip, ${q}) > 0`,
      ].join('\n       OR ')})`,
    );
  }

  // Divergence from apps/clients/cribstop/next/src/lib/filters.ts, deliberate: that client
  // suppresses `query` entirely whenever `zip`/`street` is set
  // (`if (filters.query && !filters.zip && !filters.street)`). The AC forbids the API silently
  // dropping a requested filter, so `query`, `zip` and `street` are each pushed independently
  // above and ANDed together below — none of the three suppresses another.

  if (typeof request.minPrice === 'number') {
    conditions.push(`v.price >= ${bind(request.minPrice)}`);
  }
  if (typeof request.maxPrice === 'number') {
    conditions.push(`v.price <= ${bind(request.maxPrice)}`);
  }

  // No COALESCE on beds/baths/sqft: NULL must fail the predicate so a land parcel (NULL beds) is
  // excluded by `beds>=2` rather than being coerced to 0 and matching (or failing to match) on a
  // fabricated value.
  //
  // `typeof === 'number'`, so an explicit `beds=0` IS applied as `v.beds >= 0` rather than being
  // treated as "unset". filters.ts guards with `filters.beds && filters.beds > 0`, i.e. it discards
  // a zero — but discarding a parameter the caller sent is precisely what the AC forbids, and the
  // observable difference is real: `beds >= 0` still excludes land parcels, because NULL fails it.
  // Callers wanting "any bed count" must omit the parameter, which is what the OpenAPI description
  // says. Same reasoning for `baths` and `minSqft`.
  if (typeof request.beds === 'number') {
    conditions.push(`v.beds >= ${bind(request.beds)}`);
  }
  if (typeof request.baths === 'number') {
    conditions.push(`v.baths >= ${bind(request.baths)}`);
  }
  if (typeof request.minSqft === 'number') {
    // Living area, never lot size: binds to `v.sqft`, not `v.lot_sqft`.
    conditions.push(`v.sqft >= ${bind(request.minSqft)}`);
  }

  // Case-insensitive EXACT equality, not substring — this is the card title, not a search field.
  // No COALESCE(neighborhood, city): that would make the filter match on city names.
  if (request.neighborhood) {
    conditions.push(`lower(v.neighborhood) = lower(${bind(request.neighborhood)})`);
  }

  // #722. A drill-down from a broker group. `office_key` is on `listings`, not on the view. The
  // primary key probe is cheap. `unlisted` matches the rows that carry no key.
  if (request.officeKey) {
    const keyCondition =
      request.officeKey === OFFICE_KEY_UNLISTED
        ? 'lo.office_key IS NULL'
        : `lo.office_key = ${bind(request.officeKey)}`;
    conditions.push(`EXISTS (SELECT 1 FROM listings lo WHERE lo.id = v.id AND ${keyCondition})`);
  }

  // #339. Exact match against the FIPS county code. `county_fips` is not yet populated by the
  // Bright mapper (tracked separately), so this condition ANDs in a filter that matches nothing
  // until that ships — a zero-row result, not an unfiltered one, which is what the AC requires
  // either way. The web client never sends this parameter (search-utils.tsx): it resolves a
  // county suggestion to a NAME, not a FIPS code, and a name sent here would be a permanently
  // inert filter rather than one that self-corrects once ingestion starts writing the column.
  // `boundary` below is this client's actual county mechanism; `county` is for a caller that
  // already holds a FIPS code.
  if (request.county) {
    conditions.push(`lower(v.county_fips) = lower(${bind(request.county)})`);
  }

  // #339. Client-supplied GeoJSON boundary (Nominatim-derived, simplified and size-bounded by the
  // contract's `boundary` schema). `v.geog` is masked on address_display_allowed (migration 030),
  // same as latitude/longitude, so a suppressed-address listing never matches or fails to match in
  // a way that would re-disclose its location. ANDs with any other filter sent. The web sends a
  // boundary in place of `neighborhood` and `city` (search-utils.tsx's `appendLocationParams`).
  if (request.boundary) {
    conditions.push(
      `ST_Intersects(v.geog, ST_GeomFromGeoJSON(${bind(request.boundary)})::geography)`,
    );
  }

  // #747. The user's drawn shape, an extra AND beside `boundary` and `bounds`. The contract's
  // `area` schema rejects a self-intersecting or zero-area ring, so PostGIS never sees one. `v.geog`
  // is NULL for a withheld address (migration 030), so a hidden listing never matches. Every read
  // path (list, count, pins, group rows) builds its WHERE from these conditions.
  if (request.area) {
    // The shape's padded bounding box first, so the coordinate index prunes rows before the
    // geodesic test runs. The padding covers a geodesic edge that bulges past the planar box.
    const box = areaBox(request.area);
    conditions.push(
      `v.latitude BETWEEN ${bind(box.south)} AND ${bind(box.north)}
       AND v.longitude BETWEEN ${bind(box.west)} AND ${bind(box.east)}
       AND ST_Covers(ST_GeomFromGeoJSON(${bind(request.area)})::geography, v.geog)`,
    );
  }

  // #558. The viewport, as an extra AND on the place scope. `v.latitude` and `v.longitude` are the
  // view's masked columns (migration 030). A listing with a withheld address has NULL there, fails
  // the range test, and never matches, so a viewport cannot confirm or place a hidden address. The
  // list, the map and the neighborhoods aggregate all read this one condition.
  if (request.bounds) {
    const { south, north, west, east } = request.bounds;
    conditions.push(
      `v.latitude BETWEEN ${bind(south)} AND ${bind(north)}
       AND v.longitude BETWEEN ${bind(west)} AND ${bind(east)}`,
    );
  }

  // Booleans restrict only when true, matching filters.ts's `if (filters.openHouse)` guard.
  // `false` is a documented no-op; the route layer still echoes it back via `appliedFilters`.
  if (request.openHouse === true) {
    // The view already bounds this to the soonest UPCOMING occurrence (migration 009) — this is
    // a null check on that projection, not a second copy of the time bound.
    conditions.push('v.open_house_starts_at IS NOT NULL');
  }
  if (request.newConstruction === true) {
    conditions.push('v.new_construction');
  }
  if (request.waterfront === true) {
    conditions.push("'Waterfront' = ANY(v.amenities)");
  }
  if (request.petFriendly === true) {
    conditions.push("'Pet Friendly' = ANY(v.amenities)");
  }

  // ALL requested amenities must be present — containment (`@>`), never overlap (`&&`).
  if (request.amenities && request.amenities.length > 0) {
    conditions.push(`v.amenities @> ${bind([...request.amenities])}::text[]`);
  }

  // #391. NULL >= interval is NULL, so a listing with no listed_at never matches — no COALESCE
  // needed, same reasoning `minPrice`/`maxPrice` document above.
  if (typeof request.listedWithinDays === 'number') {
    conditions.push(
      `v.listed_at >= now() - make_interval(days => ${bind(request.listedWithinDays)}::int)`,
    );
  }
  if (request.priceReduced === true) {
    conditions.push('v.price_reduced');
  }

  // #716. One card per home. The count, the page and the map pins all read this `where`, so the
  // total always equals the card count.
  conditions.push(collapseCondition());

  return {
    where: conditions.length > 0 ? conditions.join('\n  AND ') : 'TRUE',
    params,
    orderBy: SORT_ORDERS[request.sort],
  };
}
