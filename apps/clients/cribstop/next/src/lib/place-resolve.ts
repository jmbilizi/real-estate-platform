import {
  countyBaseName,
  type NeighborhoodRow,
  neighborhoodsResponseSchema,
  normalizeStreetLine,
  type SearchPlace,
  slugify,
} from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
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
      /**
       * Seeds the search bar, so that a new search from it works without a new pick.
       *
       * Omitted when a neighborhood resolves from our own data with no matching Nominatim hit
       * (#393): there is no geocoded point to seed the bar with, and the filters and label already
       * make the tile link work without one.
       */
      readonly suggestion?: SearchSuggestionValue;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'error' };

const NEIGHBORHOOD_TYPES = ['suburb', 'neighbourhood', 'quarter'];

/** One neighborhood match from `GET /listings/neighborhoods`, or `null` when the call failed. */
export type NeighborhoodsLookup = (params: {
  slug: string;
  city: string;
  state: string;
}) => Promise<NeighborhoodRow[] | null>;

/**
 * Our own neighborhood data (#390), matched by slug within a city and state. Never throws: a
 * network failure or a bad response reads as "no match", so the caller falls back to Nominatim
 * rather than erroring the whole tile link.
 */
export const gatewayNeighborhoodsLookup: NeighborhoodsLookup = async ({ slug, city, state }) => {
  const query = new URLSearchParams({ slug, city, state, limit: '5' });
  const upstream = await fetchGateway(`/property/listings/neighborhoods?${query}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).catch(() => null);
  if (!upstream || !upstream.ok) return null;
  const body = await upstream.json().catch(() => null);
  const parsed = neighborhoodsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.results : null;
};

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
  lookupNeighborhoods: NeighborhoodsLookup = gatewayNeighborhoodsLookup,
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

  /** The city result for `name`, `undefined` when there is none, `null` when the lookup failed. */
  const findCity = async (name: string, withBoundary: boolean) => {
    const results = await geocode({
      q: `${name}, ${state}`,
      limit: '5',
      addressdetails: '1',
      ...(withBoundary ? { polygon: '1' } : {}),
    });
    if (results === null) return null;
    return results.find(
      (r) => inState(r) && (sameSlug(r.name, name) || sameSlug(addressCity(r.address ?? {}), name)),
    );
  };

  if (place.kind === 'city') {
    const hit = await findCity(place.city, false);
    if (hit === null) return { status: 'error' };
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
  const lookup = geocode({
    q: `${place.name}, ${parent}`,
    limit: '5',
    addressdetails: '1',
    ...(place.kind === 'neighborhood' ? { polygon: '1' } : {}),
  });

  if (place.kind === 'street') {
    // A street is scoped to its ZIP, else to its city's boundary. The boundary, not `city`,
    // because Bright stores the postal city, which can differ from the geocoder's city.
    const [results, cityHit] = await Promise.all([
      lookup,
      place.zip ? Promise.resolve(undefined) : findCity(place.city, true),
    ]);
    if (results === null) return { status: 'error' };
    const wanted = normalizeStreetLine(place.name);
    const hit = results.find(
      (r) => inState(r) && r.address?.road && normalizeStreetLine(r.address.road) === wanted,
    );
    if (!hit) return { status: 'not-found' };
    const road = hit.address.road as string;
    // Bright addresses use USPS abbreviations ("King St"), and `street` is a substring match.
    const street = normalizeStreetLine(road);
    const city = addressCity(hit.address) ?? place.city;
    const label = placeLabel({ ...place, name: road, city });
    const boundary = cityHit ? boundaryOf(cityHit) : undefined;
    const filters: SearchFilters = place.zip
      ? { street, zip: place.zip }
      : boundary
        ? { street, state, boundary }
        : { street, city: cityHit?.name ?? city, state };
    return { status: 'found', filters, label, suggestion: suggestionOf(hit, label) };
  }

  // A neighborhood resolves against our own data first (#393): Bright subdivision names are
  // frequent, but Nominatim (OpenStreetMap) knows only the ones that are also public
  // neighborhoods, so it 404'd every subdivision name it had never heard of. One exact match here
  // is enough to render results; Nominatim is then tried only for a boundary polygon, never as the
  // sole source of a hit.
  if (place.kind === 'neighborhood') {
    const slug = slugify(place.name);
    const ours = await lookupNeighborhoods({ slug, city: place.city, state });
    if (ours && ours.length === 1) {
      const match = ours[0] as NeighborhoodRow;
      const label = placeLabel({ ...place, name: match.name, city: match.city });
      const results = await lookup;
      const hit = results?.find(
        (r) =>
          inState(r) &&
          (NEIGHBORHOOD_TYPES.includes(r.type) || NEIGHBORHOOD_TYPES.includes(r.addresstype)) &&
          (sameSlug(r.name, match.name) ||
            NEIGHBORHOOD_TYPES.some((key) => sameSlug(r.address?.[key], match.name))),
      );
      const boundary = hit ? boundaryOf(hit) : undefined;
      const filters: SearchFilters = boundary
        ? { state, boundary }
        : { neighborhood: match.name, city: match.city, state };
      return hit
        ? { status: 'found', filters, label, suggestion: suggestionOf(hit, label) }
        : { status: 'found', filters, label };
    }
    // No single match in our data (none, or an ambiguous multiple) — fall through to the
    // Nominatim-only resolution below, so a place our data does not know can still resolve.
  }

  const results = await lookup;
  if (results === null) return { status: 'error' };

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
