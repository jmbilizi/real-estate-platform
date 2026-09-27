import { countyBaseName, type SearchPlace, slugify } from '@cribstop/property-contracts';
import { buildForwardUrl } from '@/app/api/_lib/nominatim';
import { proxyNominatim } from '@/app/api/_lib/nominatim-fetch';
import type { SearchFilters } from '@/lib/types';
import type { SearchSuggestionValue } from '@/lib/store/types';
import { addressCity, addressState, placeLabel } from '@/lib/search-place';

/**
 * Resolves a search path's place to the service filters #339 uses (server only).
 *
 * A slug keeps only lower-case words, and the service matches `city` exactly, so every place is
 * looked up in the geocoder to get its real name. The lookup is also what tells an unknown slug
 * ("place not found") from a real place. Nominatim answers are cached for a day by
 * `proxyNominatim`, so a reload does not call the upstream again.
 */

/** `null` means the lookup failed. It never means "no match". */
export type Geocoder = (params: Record<string, string>) => Promise<any[] | null>;

export const nominatimGeocoder: Geocoder = async (params) => {
  const response = await proxyNominatim(buildForwardUrl(new URLSearchParams(params)), 'place path');
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  return Array.isArray(body) ? body : null;
};

export type PlaceResolution =
  | {
      readonly status: 'found';
      /** Location filters only. The page adds the listing type. */
      readonly filters: SearchFilters;
      readonly label: string;
      /** Seeds the search bar, so that a new search from it works without a new pick. */
      readonly suggestion: SearchSuggestionValue;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'error' };

const NEIGHBORHOOD_TYPES = ['suburb', 'neighbourhood', 'quarter'];

function boundaryOf(result: any): string | undefined {
  const geo = result?.geojson;
  return geo?.type === 'Polygon' || geo?.type === 'MultiPolygon' ? JSON.stringify(geo) : undefined;
}

function suggestionOf(result: any, label: string): SearchSuggestionValue {
  return {
    display_name: result.display_name ?? label,
    name: result.name,
    lat: result.lat,
    lon: result.lon,
    type: result.type,
    addresstype: result.addresstype,
    address: result.address,
  };
}

function sameSlug(a: string | undefined, b: string): boolean {
  return a !== undefined && slugify(a) === slugify(b);
}

export async function resolvePlace(
  place: SearchPlace,
  geocode: Geocoder = nominatimGeocoder,
): Promise<PlaceResolution> {
  const state = place.state;
  const inState = (result: any) => addressState(result?.address ?? {}) === state;

  if (place.kind === 'zip') {
    const results = await geocode({ postalcode: place.zip, limit: '1', addressdetails: '1' });
    if (results === null) return { status: 'error' };
    const hit = results.find(inState);
    if (!hit) return { status: 'not-found' };
    const city = addressCity(hit.address ?? {}) ?? place.city;
    const label = placeLabel({ ...place, city });
    return {
      status: 'found',
      filters: { zip: place.zip },
      label,
      suggestion: suggestionOf(hit, label),
    };
  }

  if (place.kind === 'city') {
    const results = await geocode({
      q: `${place.city}, ${state}`,
      limit: '5',
      addressdetails: '1',
    });
    if (results === null) return { status: 'error' };
    const hit = results.find(
      (r) =>
        inState(r) &&
        (sameSlug(r.name, place.city) || sameSlug(addressCity(r.address ?? {}), place.city)),
    );
    if (!hit) return { status: 'not-found' };
    const city = sameSlug(hit.name, place.city) ? hit.name : (addressCity(hit.address) as string);
    const label = placeLabel({ kind: 'city', city, state });
    return {
      status: 'found',
      filters: { city, state },
      label,
      suggestion: suggestionOf(hit, label),
    };
  }

  if (place.kind === 'county') {
    const results = await geocode({
      q: `${place.county} County, ${state}`,
      limit: '5',
      addressdetails: '1',
      polygon: '1',
    });
    if (results === null) return { status: 'error' };
    const hit = results.find(
      (r) =>
        inState(r) &&
        // Only the county itself: an independent city or a building can share the county's name.
        (r.addresstype === 'county' || r.type === 'county') &&
        sameSlug(countyBaseName(r.name ?? ''), place.county),
    );
    if (!hit) return { status: 'not-found' };
    const label = placeLabel({ kind: 'county', county: hit.address?.county ?? hit.name, state });
    // The web never sends `county` (see `appendLocationParams`). The boundary is the county filter,
    // and `state` is the fallback when there is no boundary.
    const boundary = boundaryOf(hit);
    const filters: SearchFilters = boundary ? { state, boundary } : { state };
    return { status: 'found', filters, label, suggestion: suggestionOf(hit, label) };
  }

  // Neighborhood or street, under a city+state or a ZIP.
  const parent = place.zip ? place.zip : `${place.city}, ${state}`;
  const results = await geocode({
    q: `${place.name}, ${parent}`,
    limit: '5',
    addressdetails: '1',
    ...(place.kind === 'neighborhood' ? { polygon: '1' } : {}),
  });
  if (results === null) return { status: 'error' };

  if (place.kind === 'street') {
    const hit = results.find((r) => inState(r) && sameSlug(r.address?.road, place.name));
    if (!hit) return { status: 'not-found' };
    const street = hit.address.road as string;
    const city = addressCity(hit.address) ?? place.city;
    const label = placeLabel({ ...place, name: street, city });
    // Not `city`: Bright stores the postal city, which can differ from the geocoder's city.
    const filters: SearchFilters = place.zip ? { street, zip: place.zip } : { street, state };
    return { status: 'found', filters, label, suggestion: suggestionOf(hit, label) };
  }

  const hit = results.find(
    (r) =>
      inState(r) &&
      (NEIGHBORHOOD_TYPES.includes(r.type) || NEIGHBORHOOD_TYPES.includes(r.addresstype)) &&
      (sameSlug(r.name, place.name) ||
        NEIGHBORHOOD_TYPES.some((key) => sameSlug(r.address?.[key], place.name))),
  );
  if (!hit) return { status: 'not-found' };
  const city = addressCity(hit.address ?? {}) ?? place.city;
  const name = sameSlug(hit.name, place.name)
    ? (hit.name as string)
    : (NEIGHBORHOOD_TYPES.map((key) => hit.address?.[key]).find((n) =>
        sameSlug(n, place.name),
      ) as string);
  const label = placeLabel({ ...place, name, city });
  // A resolved boundary replaces `neighborhood` and `city` (#339).
  const boundary = boundaryOf(hit);
  const filters: SearchFilters = boundary
    ? { state, boundary }
    : { neighborhood: name, city, state };
  return { status: 'found', filters, label, suggestion: suggestionOf(hit, label) };
}
