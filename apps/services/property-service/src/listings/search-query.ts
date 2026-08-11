import type { SearchRequest } from '@cribstop/property-contracts';
import { visibleListingTypesFor } from './sold-gate';

/**
 * Every sort is a total order: an `id` tiebreaker at the end, or paging repeats rows whenever two
 * listings tie on the primary key (a common case for `featured`/`last_updated`/`price`). No sort
 * carries a per-user signal, now or later — `recommended` is identical for every caller.
 */
export const SORT_ORDERS: Record<SearchRequest['sort'], string> = {
  recommended: 'v.featured DESC, v.last_updated DESC, v.id DESC',
  newest: 'v.last_updated DESC, v.id DESC',
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
  conditions.push(
    `v.listing_type = ANY(${bind([...visibleListingTypesFor(request.listingType)])})`,
  );

  if (request.propertyType !== 'all') {
    conditions.push(`v.property_type = ${bind(request.propertyType)}`);
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

  // Free-text search: title, address (masked), city, neighborhood, zip — never `description`,
  // which is third-party MLS remarks carrying a moderation state; making it searchable would be
  // keyword-based steering (PRD §6.3).
  //
  // Deliberately NOT wrapped in COALESCE(x, ''): `strpos(lower(NULL), q)` evaluates to NULL, and
  // SQL's three-valued OR treats `NULL OR TRUE` as TRUE while `NULL OR FALSE` is NULL — which
  // WHERE treats as not-matching. That is exactly the behaviour a NULL column should have here
  // (a masked address contributes nothing, never a false match), and it keeps every COALESCE out
  // of this file.
  if (request.query) {
    const q = bind(request.query);
    conditions.push(
      [
        `strpos(lower(v.title), lower(${q})) > 0`,
        `strpos(lower(v.address), lower(${q})) > 0`,
        `strpos(lower(v.city), lower(${q})) > 0`,
        `strpos(lower(v.neighborhood), lower(${q})) > 0`,
        `strpos(v.zip, ${q}) > 0`,
      ].join('\n      OR '),
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

  return {
    where: conditions.length > 0 ? conditions.join('\n  AND ') : 'TRUE',
    params,
    orderBy: SORT_ORDERS[request.sort],
  };
}
