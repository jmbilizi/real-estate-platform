import {
  countyBaseName,
  type NeighborhoodRow,
  neighborhoodsResponseSchema,
  normalizeStreetLine,
  type SearchPlace,
  slugify,
  type Suggestion,
  suggestResponseSchema,
} from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';
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
 * Our own neighborhood data (#390), matched by slug within a city and state. Never throws. `null`
 * means the call failed, and the caller reports an error, not a missing place.
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

/** Our own city, ZIP and neighborhood names (#788). `null` means the call failed. */
export type SuggestLookup = (q: string) => Promise<Suggestion[] | null>;

export const gatewaySuggestLookup: SuggestLookup = async (q) => {
  try {
    const query = new URLSearchParams({ q: q.trim().toLowerCase(), limit: '10' });
    const response = await proxyListingsRead('/suggest', query.toString(), {
      cache: true,
      store: 'suggest',
    });
    if (!response.ok) return null;
    const parsed = suggestResponseSchema.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data.suggestions : null;
  } catch {
    return null;
  }
};

/**
 * A city or ZIP from our own listing data. `undefined` means no answer, and the caller asks the
 * geocoder. It never means "not found": a place with no listing may still exist.
 */
async function resolveFromOurData(
  place: SearchPlace,
  lookupSuggest: SuggestLookup,
): Promise<PlaceResolution | undefined> {
  if (place.kind === 'zip') {
    const hit = (await lookupSuggest(place.zip))?.find(
      (s) => s.kind === 'zip' && s.zip === place.zip && s.state === place.state,
    );
    if (!hit) return undefined;
    return {
      status: 'found',
      filters: { zip: place.zip },
      label: placeLabel({ ...place, city: hit.city }),
    };
  }
  if (place.kind === 'city') {
    const hit = (await lookupSuggest(place.city.replace(/-/g, ' ')))?.find(
      (s) => s.kind === 'city' && s.state === place.state && sameSlug(s.name, place.city),
    );
    if (!hit) return undefined;
    return {
      status: 'found',
      filters: { city: hit.name, state: place.state },
      label: placeLabel({ kind: 'city', city: hit.name, state: place.state }),
    };
  }
  return undefined;
}

const RESOLVED_TTL_MS = 86_400_000;
const RESOLVED_MAX = 2_000;
const resolved = new Map<string, { value: PlaceResolution; expiresAt: number }>();

/** Test seam: drops resolved places. */
export function clearResolvedPlaces(): void {
  resolved.clear();
}

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

/**
 * Resolves from our own data first and asks the geocoder only on a miss. A found place is kept for
 * 24 hours, so repeat crawls of one place cost nothing. A failure is never kept.
 */
export async function resolvePlace(
  place: SearchPlace,
  geocode: Geocoder = nominatimGeocoder,
  lookupNeighborhoods: NeighborhoodsLookup = gatewayNeighborhoodsLookup,
  lookupSuggest: SuggestLookup = gatewaySuggestLookup,
): Promise<PlaceResolution> {
  const key = JSON.stringify(place);
  const kept = resolved.get(key);
  if (kept && kept.expiresAt > Date.now()) return kept.value;

  const ours = await resolveFromOurData(place, lookupSuggest);
  const result = ours ?? (await resolveWithGeocoder(place, geocode, lookupNeighborhoods));
  if (result.status === 'found') {
    if (resolved.size >= RESOLVED_MAX) resolved.delete(resolved.keys().next().value as string);
    resolved.set(key, { value: result, expiresAt: Date.now() + RESOLVED_TTL_MS });
  }
  return result;
}

async function resolveWithGeocoder(
  place: SearchPlace,
  geocode: Geocoder,
  lookupNeighborhoods: NeighborhoodsLookup,
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

  // A neighborhood resolves only from our own data (#533). The slug matches exactly within the
  // city and state. The filters are the exact `neighborhood`+`city`+`state` filters that the
  // neighborhood card counts with. A geographic boundary would count other homes, so it is never a
  // filter. A slug with no match is "not found", never a city search. Nominatim only seeds the
  // search bar, and a miss there changes nothing.
  const ours = await lookupNeighborhoods({ slug: slugify(place.name), city: place.city, state });
  if (ours === null) return { status: 'error' };
  const match = ours.find(
    (row) =>
      row.state === state && sameSlug(row.city, place.city) && sameSlug(row.name, place.name),
  );
  if (!match) return { status: 'not-found' };
  const label = placeLabel({ ...place, name: match.name, city: match.city });
  const filters: SearchFilters = { neighborhood: match.name, city: match.city, state };
  const results = await lookup;
  const hit = results?.find(
    (r) =>
      inState(r) &&
      (NEIGHBORHOOD_TYPES.includes(r.type) || NEIGHBORHOOD_TYPES.includes(r.addresstype)) &&
      (sameSlug(r.name, match.name) ||
        NEIGHBORHOOD_TYPES.some((key) => sameSlug(r.address?.[key], match.name))),
  );
  return hit
    ? { status: 'found', filters, label, suggestion: suggestionOf(hit, label) }
    : { status: 'found', filters, label };
}
