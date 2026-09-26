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

/**
 * "Washington, DC" / "Washington DC" / "DC", typed verbatim, checked before any suggestion type —
 * the same guarantee `bareZip` gives a zip. Washington, D.C. is a Nominatim `district`, which
 * `extractSearchTerms` below also resolves correctly now, but the AC (#339) names these three
 * literal strings, so this is a second, independent guarantee that does not depend on Nominatim's
 * response shape at all.
 */
const DC_LITERAL = /^(washington,?\s*d\.?\s*c\.?|d\.?c\.?)$/i;
export function bareDC(value: string): string | undefined {
  return DC_LITERAL.test((value || '').trim()) ? 'DC' : undefined;
}

/** Every field one resolved suggestion can imply. Never more than one "shape" is populated at
 *  once — see `extractSearchTerms`. */
export interface LocationFilters {
  zip?: string;
  street?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  county?: string;
}

/** True if a resolved suggestion implies at least one filter. Used to refuse a search that would
 *  otherwise run unfiltered (#339) — every branch of `extractSearchTerms` below is meant to
 *  always set one, but a caller that failed to would rather learn that than run unfiltered. */
export function hasLocationFilter(terms: LocationFilters): boolean {
  return Boolean(
    terms.zip || terms.street || terms.city || terms.state || terms.neighborhood || terms.county,
  );
}

const NEIGHBORHOOD_TYPES = ['suburb', 'neighbourhood', 'quarter'];
const CITY_TYPES = ['city', 'town', 'village', 'hamlet'];
const COUNTY_TYPES = ['county'];
const STATE_TYPES = ['state'];
// Nominatim's own vocabulary for a state-level or larger administrative area is inconsistent
// across versions and countries — Washington, D.C. (the bug this ticket fixes) has come back
// tagged all three ways. Handled as one bucket: prefer whatever address component IS present,
// most specific first, rather than trusting the type name to say which one that is.
const DISTRICT_TYPES = ['district', 'state_district', 'administrative'];

function resolveState(address: Record<string, string | undefined>): string | undefined {
  return address.state_code || (address.state ? stateAbbr(address.state) : undefined);
}

/**
 * Extract the one structured filter a suggestion implies — never more than one shape.
 *
 * A place search has these shapes: a picked postcode, a picked road/house, a picked
 * city/town/village, a picked neighborhood/suburb/quarter (inside a city), a picked county, a
 * picked state, or a district-class hit (Washington, D.C. and similar) resolved by whichever
 * address component it actually carries. Each maps to its own filter set, so the API never has to
 * AND two location filters that could disagree (a city holds many zips; a zip can straddle two
 * cities) — see `listings-query.ts`'s precedence rules for how the API-facing proxy enforces that.
 *
 * Every branch returns at least one field whenever the address has ANY of
 * neighbourhood/city/county/state — `{}` is reachable only when Nominatim's address block is
 * empty, which `/api/geocode`'s `countrycodes=us` filter makes vanishingly rare. Callers still
 * check `hasLocationFilter` before searching (#339's "never unfiltered" requirement) rather than
 * trust that as a proof.
 */
export function extractSearchTerms(loc: any): LocationFilters {
  const address = loc.address || {};
  if (loc.type === 'postcode' && address.postcode) return { zip: address.postcode };
  if ((loc.type === 'road' || loc.type === 'house' || loc.type === 'residential') && address.road) {
    const street = address.house_number ? `${address.house_number} ${address.road}` : address.road;
    return { street };
  }

  const state = resolveState(address);

  if (NEIGHBORHOOD_TYPES.includes(loc.type)) {
    const neighborhood = address.suburb || address.neighbourhood || address.quarter;
    const city = address.city || address.town || address.village;
    const result: LocationFilters = {};
    if (neighborhood) result.neighborhood = neighborhood;
    if (city) result.city = city;
    if (state) result.state = state;
    return result;
  }

  if (CITY_TYPES.includes(loc.type)) {
    const city = address.city || address.town || address.village || address.hamlet;
    const result: LocationFilters = {};
    if (city) result.city = city;
    if (state) result.state = state;
    return result;
  }

  if (COUNTY_TYPES.includes(loc.type)) {
    const county = address.county || loc.name;
    const result: LocationFilters = {};
    if (county) result.county = county;
    if (state) result.state = state;
    return result;
  }

  if (STATE_TYPES.includes(loc.type)) {
    return state ? { state } : {};
  }

  if (DISTRICT_TYPES.includes(loc.type)) {
    const city = address.city || address.town || address.village;
    if (city) return state ? { city, state } : { city };
    if (address.county)
      return state ? { county: address.county, state } : { county: address.county };
    return state ? { state } : {};
  }

  return {};
}

/** The one structured filter this search implies — a typed bare zip or "DC" literal wins over
 *  whatever the suggestion resolved to, so an autocomplete mismatch can never send it as free
 *  text (#220), and the literal DC strings the AC names always resolve regardless of how
 *  Nominatim happened to tag that particular hit. */
export function resolveSearchTerms(typedValue: string, loc: any): LocationFilters {
  const zip = bareZip(typedValue);
  if (zip) return { zip };
  const dc = bareDC(typedValue);
  if (dc) return { state: dc };
  return extractSearchTerms(loc);
}

/**
 * Re-fetches a suggestion's boundary polygon on demand, for the two place types (neighborhood,
 * county) where a boundary sharpens an otherwise flat text match — see search-query.ts's AC.
 *
 * Never included in the original suggestion list: `/api/geocode`'s `polygon=1` flag adds real
 * cost (an OSM boundary relation, simplified server-side, still several KB), which is fine once
 * per selection but not once per keystroke across up to `limit=5` suggestions.
 *
 * Re-issues the SAME `q` the original suggestion resolved from — the same idiom
 * `SearchExperience.tsx` already uses for the results-page map boundary — rather than adding a
 * lookup-by-osm-id endpoint this proxy does not expose. Nominatim's ranking for one query string
 * is deterministic, so the top result is the same place.
 */
export async function fetchBoundaryFor(
  loc: any,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const q = loc?.display_name;
  if (!q) return undefined;
  try {
    const params = new URLSearchParams({ q, limit: '1', addressdetails: '0', polygon: '1' });
    const resp = await fetch(`/api/geocode?${params.toString()}`, { signal });
    if (!resp.ok) return undefined;
    const data = await resp.json();
    const geo = data?.[0]?.geojson;
    if (geo?.type !== 'Polygon' && geo?.type !== 'MultiPolygon') return undefined;
    return JSON.stringify(geo);
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    console.error('[Nominatim] Boundary fetch failed', e);
    return undefined;
  }
}

/**
 * Writes every filter a resolved suggestion implies onto `params`, fetching the boundary polygon
 * too when the filter is neighborhood or county (#339).
 *
 * **The web never sends `county`.** `extractSearchTerms` resolves it to a Nominatim place NAME
 * ("Fairfax County"), and `search-query.ts` matches the contract's `county` parameter against the
 * `county_fips` CODE column ("51059") — a name can never equal a code, so sending it would not be
 * a working filter that degrades once ingestion catches up, it would be a permanently-inert one.
 * `boundary` is the only mechanism this client has for a county today, because `geog` is already
 * populated (from lat/long) where `county_fips` is not. If the boundary fetch fails, the request
 * still degrades to whatever `state` was resolved above — coarser than a county, but a real,
 * populated filter — rather than an unfiltered one. `county` stays a contract parameter for a
 * caller that already has the FIPS code; this client is not one.
 *
 * A resolved boundary replaces `neighborhood` and `city`. `neighborhood` and `city` are the
 * fallback when the boundary fetch fails.
 */
/**
 * Returns whether at least one filter was actually written to `params`.
 *
 * A synchronous `hasLocationFilter(resolveSearchTerms(...))` check at the call site is not
 * sufficient on its own: a county resolution with no `state` in its address (rare, but not
 * provably impossible) depends entirely on the boundary fetch below, which is async and can fail.
 * Without this return value, that combination would write nothing to `params` at all and the
 * caller would search on `q` alone — unfiltered, exactly what #339 forbids. Callers must check it
 * and refuse to search when it is false, the same way they refuse an unresolved suggestion.
 */
export async function appendLocationParams(
  params: URLSearchParams,
  typedValue: string,
  loc: any,
  signal?: AbortSignal,
): Promise<boolean> {
  const terms = resolveSearchTerms(typedValue, loc);
  let applied = false;
  if (terms.zip) {
    params.set('zip', terms.zip);
    applied = true;
  }
  if (terms.street) {
    params.set('street', terms.street);
    applied = true;
  }
  if (terms.city) {
    params.set('city', terms.city);
    applied = true;
  }
  if (terms.state) {
    params.set('state', terms.state);
    applied = true;
  }
  if (terms.neighborhood) {
    params.set('neighborhood', terms.neighborhood);
    applied = true;
  }

  if (terms.neighborhood || terms.county) {
    const boundary = await fetchBoundaryFor(loc, signal);
    if (boundary) {
      // The boundary replaces the text filters. Bright's SubdivisionName is often a plat or condo
      // name, and its City is the postal city, so ANDing either one drops listings inside the area.
      params.delete('neighborhood');
      params.delete('city');
      params.set('boundary', boundary);
      applied = true;
    }
  }

  return applied;
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
