import { type PathSegment } from '@/lib/city-summary';
import { searchPath } from '@cribstop/property-contracts';
import type { ZipGroup } from '@cribstop/property-contracts';
import type { JsonLdObject } from '@/lib/listing-jsonld';

/** The most nearby ZIP links a ZIP page lists (#973). */
export const NEARBY_ZIPS_MAX = 8;

export type Crumb = { readonly name: string; readonly path: string };

/**
 * Home, City, ZIP (#973). There is no state level, because no state page exists. The City level
 * is present only when `area` names the one city the feed maps the ZIP to.
 */
export function zipBreadcrumbs(
  zip: string,
  segment: PathSegment,
  area: { readonly city: string; readonly state: string } | undefined,
): Crumb[] {
  return [
    { name: 'Home', path: '/' },
    ...(area
      ? [
          {
            name: `${area.city}, ${area.state}`,
            path: searchPath({ kind: 'city', city: area.city, state: area.state }, segment),
          },
        ]
      : []),
    { name: zip, path: searchPath({ kind: 'zip-only', zip }, segment) },
  ];
}

/** `BreadcrumbList` structured data. Null when no origin is vouched for, as every node needs a URL. */
export function breadcrumbJsonLd(
  origin: string | null,
  crumbs: readonly Crumb[],
): JsonLdObject | null {
  if (origin === null) return null;
  const base = origin.replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${base}${crumb.path}`,
    })),
  };
}

export type NearbyZip = { readonly zip: string; readonly count: number; readonly path: string };

/**
 * Up to 8 other ZIPs of the same city that meet the listing threshold. Order: active listing count
 * descending, then ZIP ascending. The current ZIP never appears.
 */
export function nearbyZips(
  groups: readonly ZipGroup[],
  currentZip: string,
  segment: PathSegment,
  minListings: number,
): NearbyZip[] {
  return groups
    .filter((group) => group.key !== currentZip && group.count >= minListings)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, NEARBY_ZIPS_MAX)
    .map((group) => ({
      zip: group.key,
      count: group.count,
      path: searchPath({ kind: 'zip-only', zip: group.key }, segment),
    }));
}
