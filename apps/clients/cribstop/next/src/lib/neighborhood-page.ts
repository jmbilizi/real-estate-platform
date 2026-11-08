import {
  neighborhoodKey,
  type NeighborhoodRow,
  searchPath,
  type SearchPlace,
} from '@cribstop/property-contracts';
import type { PathSegment } from '@/lib/city-summary';
import type { Crumb } from '@/lib/zip-page';

/** The most other-neighborhood links a neighborhood page lists (#974). */
export const NEARBY_NEIGHBORHOODS_MAX = 8;

export type NeighborhoodPlace = Extract<SearchPlace, { kind: 'neighborhood' | 'street' }>;

/**
 * Home, City, Neighborhood (#974). There is no state level, because no state page exists. `name`
 * and `area` are the names the feed holds. The path words are lower case slugs and name nothing.
 */
export function neighborhoodBreadcrumbs(
  place: NeighborhoodPlace,
  name: string,
  area: { readonly city: string; readonly state: string },
  segment: PathSegment,
): Crumb[] {
  return [
    { name: 'Home', path: '/' },
    {
      name: `${area.city}, ${area.state}`,
      path: searchPath({ kind: 'city', city: area.city, state: area.state }, segment),
    },
    { name, path: searchPath(place, segment) },
  ];
}

export type NearbyNeighborhood = {
  readonly name: string;
  readonly count: number;
  readonly path: string;
};

/**
 * Up to 8 other neighborhoods of the same city that meet the listing threshold. Order: active
 * listing count descending, then name ascending. No other order applies. The current neighborhood
 * never appears.
 */
export function nearbyNeighborhoods(
  rows: readonly NeighborhoodRow[],
  current: { readonly name: string; readonly city: string; readonly state: string },
  segment: PathSegment,
  minListings: number,
): NearbyNeighborhood[] {
  const currentKey = neighborhoodKey(current);
  return rows
    .filter((row) => row.key !== currentKey && row.total >= minListings)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, NEARBY_NEIGHBORHOODS_MAX)
    .map((row) => ({
      name: row.name,
      count: row.total,
      path: searchPath(
        { kind: 'neighborhood', name: row.name, city: row.city, state: row.state },
        segment,
      ),
    }));
}
