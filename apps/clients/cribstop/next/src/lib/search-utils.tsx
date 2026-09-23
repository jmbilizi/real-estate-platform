import React from 'react';

// US state name → 2-letter abbreviation
export const US_STATE_ABBR: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
};

export function stateAbbr(name: string): string {
  return US_STATE_ABBR[name] || name || '';
}

// Split into primary (the identifier the user searched for) and secondary (context).
export function getLocationParts(loc: any): { primary: string; secondary: string } {
  const address = loc.address || {};
  const houseNumber = address.house_number || '';
  const road = address.road || '';
  const suburb = address.suburb || address.neighbourhood || address.quarter || '';
  const city = address.city || address.town || address.village || address.hamlet || '';
  const raw = address.state || '';
  const st = address.state_code || stateAbbr(raw);
  const zip = address.postcode || '';
  const country = address.country || '';
  const isUS = !country || country === 'United States';
  const cityState = [city, st].filter(Boolean).join(', ');
  const cityStateZip = zip ? `${cityState} ${zip}`.trim() : cityState;

  if (houseNumber && road) {
    return { primary: `${houseNumber} ${road}`, secondary: cityStateZip };
  }

  if (loc.type === 'postcode') {
    const z = zip || loc.display_name?.split(',')[0]?.trim() || '';
    return { primary: z, secondary: cityState };
  }

  if (road) {
    return { primary: road, secondary: cityState };
  }

  if (suburb && city) {
    return { primary: suburb, secondary: cityState };
  }

  if (city) {
    const nonUsCountry = !isUS ? country : '';
    return { primary: city, secondary: [st, nonUsCountry].filter(Boolean).join(', ') };
  }

  const fallbackState = loc._hint_state || '';
  const displayName = loc.display_name || '';
  return { primary: displayName, secondary: fallbackState };
}

// Build standard US-format label → always a single line.
export function formatLocationLabel(loc: any): string {
  const { primary, secondary } = getLocationParts(loc);
  if (!primary) return '';
  if (!secondary) return primary;
  if (loc.type === 'postcode') return `${secondary} ${primary}`;
  return `${primary}, ${secondary}`;
}

/** A value unambiguous enough to be a zip on its own, checked before any suggestion type. */
export function bareZip(value: string): string | undefined {
  const trimmed = (value || '').trim();
  return /^\d{5}$/.test(trimmed) ? trimmed : undefined;
}

/** Suggestion types that name a place smaller than a city but resolved the same way — the
 *  address block still carries a `city`, and this is what puts it on screen (`getLocationParts`). */
const CITY_LIKE_TYPES = ['city', 'town', 'village', 'suburb', 'neighbourhood', 'hamlet', 'quarter'];

/**
 * Extract the one structured filter a suggestion implies — never more than one shape.
 *
 * A place search has three shapes: a picked postcode, a picked road/house, and a picked
 * city/town/village (or a smaller place inside one). Each maps to its own filter set, so the API
 * never has to AND two location filters that could disagree (a city holds many zips; a zip can
 * straddle two cities).
 */
export function extractSearchTerms(
  loc: any,
): { zip?: string; street?: string; city?: string; state?: string } {
  const address = loc.address || {};
  if (loc.type === 'postcode' && address.postcode) return { zip: address.postcode };
  if ((loc.type === 'road' || loc.type === 'house' || loc.type === 'residential') && address.road) {
    const street = address.house_number ? `${address.house_number} ${address.road}` : address.road;
    return { street };
  }
  if (CITY_LIKE_TYPES.includes(loc.type)) {
    const city = address.city || address.town || address.village;
    const state = address.state_code || stateAbbr(address.state || '');
    const result: { city?: string; state?: string } = {};
    if (city) result.city = city;
    if (state) result.state = state;
    return result;
  }
  return {};
}

/** The one structured filter this search implies — a typed bare zip wins over whatever the
 *  suggestion resolved to, so an autocomplete mismatch can never send it as free text (#220). */
export function resolveSearchTerms(
  typedValue: string,
  loc: any,
): { zip?: string; street?: string; city?: string; state?: string } {
  const zip = bareZip(typedValue);
  return zip ? { zip } : extractSearchTerms(loc);
}

// Highlight the portion of `text` that matches `query` (case-insensitive).
export function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query?.trim();
  if (!q) return <span className="font-semibold">{text}</span>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <span className="font-semibold">{text}</span>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

/**
 * How many nearby places one lookup may return.
 *
 * Every row costs a reverse-geocode call at each call site, which enriches them with
 * `Promise.all` — so an uncapped result set is an uncapped burst of concurrent upstream requests
 * from a single server IP, against a service whose policy is 1 req/s. Capping here rather than at
 * the two call sites means the bound cannot be forgotten by a third one.
 *
 * Eight is comfortably more than the dropdown shows before it scrolls; Overpass returns them in the
 * order the query produced, which for a radius search is near enough to "closest first".
 */
const MAX_NEARBY_PLACES = 8;

/**
 * Coordinate precision, in decimal places, for the nearby-places request URL.
 *
 * This is what makes the proxy's `Cache-Control` worth anything. The browser's HTTP cache keys on
 * the URL *this* function builds, so passing the map centre through at full float precision
 * (`38.89553417351007`) minted a URL never seen before on every pixel of pan and the cache could
 * not hit once. Three decimals is ~110m, which against a radius measured in kilometres cannot
 * change which towns come back.
 *
 * `/api/overpass` rounds to the same grid on its side — it cannot trust a client not to. The two
 * are therefore duplicated on purpose, and a drift between them is a *cache-hit* regression rather
 * than a correctness one: the server's rounding still decides the answer either way.
 *
 * **Duplicated, but not unchecked.** The constant is imported rather than shared because the server
 * side of it lives in `app/api/_lib/overpass.ts` alongside the upstream query builder, and pulling
 * that module into client code would drag server-only query construction into the browser bundle to
 * save one number. So the pair is asserted equal in `app/api/_lib/overpass.spec.ts` instead — which
 * is why this is exported despite having no other caller. Claiming in a comment that drift is
 * harmless while nothing tests for it is how it stops being harmless.
 */
export const NEARBY_COORD_PRECISION = 3;

// Fetch nearby cities/towns/villages via the internal Overpass proxy (`/api/overpass`).
// Overpass doesn't reliably emit CORS headers, so this can't hit the upstream API directly
// from the browser — see src/app/api/overpass/route.ts.
export async function fetchNearbyLocationsByType(
  lat: number,
  lon: number,
  placeType: 'city' | 'town' | 'village',
  radiusMeters = 20000,
  signal?: AbortSignal,
): Promise<any[]> {
  const params = new URLSearchParams({
    lat: lat.toFixed(NEARBY_COORD_PRECISION),
    lon: lon.toFixed(NEARBY_COORD_PRECISION),
    placeType,
    radiusMeters: String(radiusMeters),
  });
  try {
    const response = await fetch(`/api/overpass?${params.toString()}`, { signal });
    if (!response.ok) {
      console.warn('[Overpass] API returned', response.status);
      return [];
    }
    const data = await response.json();
    if (!data.elements) return [];
    return data.elements.slice(0, MAX_NEARBY_PLACES).map((el: any) => ({
      display_name: el.tags?.name || 'Unnamed',
      lat: el.lat,
      lon: el.lon,
      type: el.tags?.place,
      ...el.tags,
    }));
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    console.error('[Overpass] Nearby fetch failed', e);
    return [];
  }
}
