import type { NeighborhoodRow as NeighborhoodApiRow } from '@cribstop/property-contracts';
import type { Neighborhood } from '@/components/NeighborhoodRow';
import { BRAND } from '@/lib/brand';
import { GROUP_BY_PARAM } from '@/lib/group-by';
import { searchTargetUrl } from '@/lib/search-place';

/** A neighborhood needs this many matching listings to be worth a tile (compliance: no fabricated
 *  "up-and-coming" framing off a single listing). */
export const NEIGHBORHOODS_MIN_COUNT = 5;

/** The row-to-tile mapping, shared by the home page row and the grouped search. */
export function toNeighborhood(row: NeighborhoodApiRow): Neighborhood {
  return {
    name: row.name,
    city: row.city,
    state: row.state,
    sale: row.sale,
    rent: row.rent,
    previewPhotos: row.previewPhotos,
  };
}

/** Appends `rows` to `merged`, skipping any `slug|city|state` already in `seen`. */
export function addNeighborhoodRows(
  rows: readonly NeighborhoodApiRow[],
  seen: Set<string>,
  merged: Neighborhood[],
): void {
  for (const row of rows) {
    const key = `${row.slug}|${row.city}|${row.state}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(toNeighborhood(row));
  }
}

export type NeighborhoodsScope =
  | { kind: 'all' }
  | { kind: 'state'; state: string }
  | { kind: 'city'; state: string; city: string };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads the scope from the URL. A `state` that is malformed or not licensed gives the all-states
 * view, and `city` is ignored with it. A blank `city` is no city.
 */
export function parseNeighborhoodsScope(
  params: Record<string, string | string[] | undefined>,
): NeighborhoodsScope {
  const raw = first(params.state)?.trim().toUpperCase();
  const licensed: readonly string[] = BRAND.licensedStateCodes;
  if (!raw || !/^[A-Z]{2}$/.test(raw) || !licensed.includes(raw)) return { kind: 'all' };
  const city = first(params.city)?.trim().slice(0, 80);
  return city ? { kind: 'city', state: raw, city } : { kind: 'state', state: raw };
}

/**
 * The grouped search for a region (#504). It uses the same builder as the homes-for-sale See all.
 * A city scope is a city place path, a state scope keeps `state` in the query, and no region is
 * the default scope. `type=all` keeps both the sale and the rent counts a tile shows.
 */
export function groupedSearchHref(scope: NeighborhoodsScope): string {
  const extra = new URLSearchParams({ [GROUP_BY_PARAM]: 'neighborhood' });
  if (scope.kind === 'city') {
    return searchTargetUrl(
      { kind: 'place', place: { kind: 'city', city: scope.city, state: scope.state } },
      'all',
      extra,
    );
  }
  const params = new URLSearchParams();
  if (scope.kind === 'state') params.set('state', scope.state);
  return searchTargetUrl({ kind: 'area', params }, 'all', extra);
}

/** The home page row's link. No region, or a region with no state, gives the default scope. */
export function neighborhoodsHref(region: { city: string; state: string } | null): string {
  return groupedSearchHref(parseNeighborhoodsScope({ state: region?.state, city: region?.city }));
}

/** The widest span, in degrees, a neighborhood's bounds may have to drive a map fit (#503). */
const MAX_FIT_SPAN_DEGREES = 1;

/**
 * The row's bounds if they can drive a map fit, else null. The service can return bounds that a
 * stray 0 coordinate stretched to 0,0. The licensed states lie far from 0,0, so a zero edge, a box
 * that misses its own centroid, or a box wider than a neighborhood is not a fit target. The map
 * then keeps its listing-driven fit.
 */
export function usableFitBounds(
  row: NeighborhoodApiRow,
): NonNullable<NeighborhoodApiRow['bounds']> | null {
  const { bounds: b, centroid: c } = row;
  if (!b) return null;
  const edges = [b.south, b.west, b.north, b.east];
  if (!edges.every(Number.isFinite) || edges.some((e) => e === 0)) return null;
  if (b.south >= b.north || b.west >= b.east) return null;
  if (b.north - b.south > MAX_FIT_SPAN_DEGREES || b.east - b.west > MAX_FIT_SPAN_DEGREES) {
    return null;
  }
  if (c && (c.lat < b.south || c.lat > b.north || c.lng < b.west || c.lng > b.east)) return null;
  return b;
}
