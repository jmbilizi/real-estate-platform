import {
  countyBaseName,
  propertyPath,
  searchPath,
  type SearchPathSegment,
  type SearchPlace,
} from '@cribstop/property-contracts';
import type { SearchFilters } from '@/lib/types';
import { parseFiltersFromSearchParams } from '@/lib/listing-filters';
import { legacyDrillUrl } from '@/lib/neighborhood-url';
import { bareDC, bareZip, stateAbbr } from '@/lib/search-utils';

/**
 * Search URLs (#350): a search bar pick becomes a path, and a path becomes the service filters.
 * The slug rules live in `@cribstop/property-contracts` (`searchPath`, `parseSearchPath`). This
 * module maps geocoder results to and from them.
 */

export type ListingTypeChoice = NonNullable<SearchFilters['listingType']> | 'all';

/** Where a search bar pick goes. */
export type SearchTarget =
  | { readonly kind: 'place'; readonly place: SearchPlace }
  /** An address pick goes to the property page. */
  | { readonly kind: 'property'; readonly path: string }
  /** No place path can express this pick (a state, a ZIP with no city). */
  | { readonly kind: 'area'; readonly params: URLSearchParams };

const ROAD_TYPES = ['road', 'house', 'residential'];
const NEIGHBORHOOD_TYPES = ['suburb', 'neighbourhood', 'quarter'];
const CITY_TYPES = ['city', 'town', 'village', 'hamlet', 'township', 'municipality'];
const COUNTY_TYPES = ['county'];
const DISTRICT_TYPES = ['district', 'state_district', 'administrative'];

type Address = Record<string, string | undefined>;

/** Two-letter state from a Nominatim address block. */
export function addressState(address: Address): string | undefined {
  const iso = /^US-([A-Z]{2})$/.exec(address['ISO3166-2-lvl4'] ?? '');
  const code = address.state_code ?? iso?.[1] ?? (address.state ? stateAbbr(address.state) : '');
  return /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : undefined;
}

/** The city a Nominatim address sits in. Village and township count as the city (Bright City). */
export function addressCity(address: Address): string | undefined {
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.township ||
    address.municipality ||
    undefined
  );
}

function zip5(value: string | undefined): string | undefined {
  const match = /^(\d{5})/.exec(value ?? '');
  return match?.[1];
}

function placeType(loc: any): string {
  return loc?.addresstype && CITY_TYPES.includes(loc.addresstype) ? loc.addresstype : loc?.type;
}

/**
 * Maps a picked suggestion to a search target. `null` when the pick cannot be searched: a street
 * or neighborhood with no city+state parent, or no place at all.
 */
export function searchTargetFor(typedValue: string, loc: any): SearchTarget | null {
  const address: Address = loc?.address ?? {};
  const state = addressState(address);
  const city = addressCity(address);
  const type = placeType(loc);

  const typedZip = bareZip(typedValue);
  if (typedZip || type === 'postcode') {
    const zip = typedZip ?? zip5(address.postcode);
    if (!zip) return null;
    if (city && state) return { kind: 'place', place: { kind: 'zip', zip, city, state } };
    return { kind: 'area', params: new URLSearchParams({ zip }) };
  }
  if (bareDC(typedValue)) {
    return { kind: 'place', place: { kind: 'city', city: 'Washington', state: 'DC' } };
  }

  if (ROAD_TYPES.includes(type) && address.road) {
    if (!city || !state) return null;
    if (address.house_number) {
      const path = propertyPath(
        {
          streetLine: `${address.house_number} ${address.road}`,
          unitNumber: address.unit ?? null,
          city,
          state,
          zip: null,
        },
        { withZip: false },
      );
      return { kind: 'property', path };
    }
    return { kind: 'place', place: { kind: 'street', name: address.road, city, state } };
  }

  if (NEIGHBORHOOD_TYPES.includes(type)) {
    const name = loc.name || address.suburb || address.neighbourhood || address.quarter;
    if (!name || !city || !state) return null;
    return { kind: 'place', place: { kind: 'neighborhood', name, city, state } };
  }

  if (CITY_TYPES.includes(type)) {
    const name = loc.name || city;
    if (!name || !state) return null;
    return { kind: 'place', place: { kind: 'city', city: name, state } };
  }

  if (COUNTY_TYPES.includes(type)) {
    const county = address.county || loc.name;
    if (!county || !state) return null;
    return { kind: 'place', place: { kind: 'county', county, state } };
  }

  if (type === 'state' || DISTRICT_TYPES.includes(type)) {
    if (DISTRICT_TYPES.includes(type) && city && state) {
      return { kind: 'place', place: { kind: 'city', city, state } };
    }
    if (DISTRICT_TYPES.includes(type) && address.county && state) {
      return { kind: 'place', place: { kind: 'county', county: address.county, state } };
    }
    return state ? { kind: 'area', params: new URLSearchParams({ state }) } : null;
  }

  return null;
}

/**
 * The suggestions the search bar offers: only picks that a path can express. A street or
 * neighborhood with no city+state parent is left out.
 */
export function searchableSuggestions(results: unknown): any[] {
  return Array.isArray(results) ? results.filter((loc) => searchTargetFor('', loc) !== null) : [];
}

export function listingSegmentFor(listingType: ListingTypeChoice | undefined): SearchPathSegment {
  return listingType === 'rent' ? 'homes-for-rent' : 'homes-for-sale';
}

/**
 * The listing type a search path applies. The segment gives `sale` or `rent`. A `type` query
 * parameter (`all`, `sold`) overrides it, and is the only listing type the query string carries.
 */
export function listingTypeForPath(
  segment: SearchPathSegment,
  typeParam: string | null,
): { listingType: SearchFilters['listingType']; override: string | null } {
  if (typeParam === 'all') return { listingType: undefined, override: 'all' };
  if (typeParam === 'sold') return { listingType: 'sold', override: 'sold' };
  return { listingType: segment === 'homes-for-rent' ? 'rent' : 'sale', override: null };
}

/** The `type` query parameter a search needs on top of its path segment, if any. */
function listingTypeOverride(listingType: ListingTypeChoice | undefined): string | null {
  if (listingType === 'sale' || listingType === 'rent') return null;
  return listingType ?? 'all';
}

/** The URL for a search bar target. */
export function searchTargetUrl(
  target: SearchTarget,
  listingType: ListingTypeChoice | undefined,
  extra?: URLSearchParams,
): string {
  if (target.kind === 'property') return target.path;
  const segment = listingSegmentFor(listingType);
  const params = new URLSearchParams(target.kind === 'area' ? target.params : undefined);
  const override = listingTypeOverride(listingType);
  if (override) params.set('type', override);
  extra?.forEach((value, key) => params.append(key, value));
  const qs = params.toString();
  const path = searchPath(target.kind === 'place' ? target.place : null, segment);
  return qs ? `${path}?${qs}` : path;
}

/** The display label for a place, with its parent ("Del Ray, Alexandria, VA"). */
export function placeLabel(place: SearchPlace): string {
  switch (place.kind) {
    case 'city':
      return `${place.city}, ${place.state}`;
    case 'zip':
      return `${place.city}, ${place.state} ${place.zip}`;
    case 'county':
      return `${countyBaseName(place.county)} County, ${place.state}`;
    default:
      return `${place.name}, ${place.zip ?? `${place.city}, ${place.state}`}`;
  }
}

/** Query keys that name a place. A place path carries them in the path, never the query. */
export const PLACE_QUERY_KEYS = [
  'q',
  'lat',
  'lon',
  'zip',
  'street',
  'city',
  'state',
  'neighborhood',
  'boundary',
  'bounds',
  'type',
  'listingType',
] as const;

/** A copy of `params` without the place keys. */
export function withoutPlaceKeys(params: URLSearchParams): URLSearchParams {
  const rest = new URLSearchParams(params);
  for (const key of PLACE_QUERY_KEYS) rest.delete(key);
  return rest;
}

/**
 * The new URL for a legacy `/search?...` link. A city+state (with an optional neighborhood or
 * street) becomes a place path. Anything else keeps its query on the map-area path.
 */
export function legacySearchUrl(params: URLSearchParams): string {
  const filters = parseFiltersFromSearchParams(params);
  const { city, state, neighborhood, street } = filters;
  let place: SearchPlace | null = null;
  // A neighborhood link is the neighborhood path (#533), with `groupFrom` read as `from`.
  if (neighborhood && city && state) {
    const type = filters.listingType ?? 'all';
    const url = legacyDrillUrl(null, type, params);
    if (url) return url;
  }
  if (city && state) {
    if (street) place = { kind: 'street', name: street, city, state };
    else place = { kind: 'city', city, state };
  }

  const rest = place ? withoutPlaceKeys(params) : new URLSearchParams(params);
  rest.delete('type');
  rest.delete('listingType');
  const override = listingTypeOverride(filters.listingType);
  if (override) rest.set('type', override);

  const path = searchPath(place, listingSegmentFor(filters.listingType));
  const qs = rest.toString();
  return qs ? `${path}?${qs}` : path;
}

/** A `bounds=<n,e,s,w>` map rectangle as a GeoJSON polygon string. `undefined` when invalid. */
export function boundsToBoundary(bounds: string | null): string | undefined {
  const parts = (bounds ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [north, east, south, west] = parts as [number, number, number, number];
  if (north <= south || north > 90 || south < -90 || east > 180 || west < -180) return undefined;
  const ring = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
    [west, north],
  ];
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
}
