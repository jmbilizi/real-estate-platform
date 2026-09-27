/**
 * The property page URL (#349): `/<city>-<st>/<address-slug>`, for example
 * `/alexandria-va/118-baggett-place-alexandria-va`. A unit adds `unit-<n>` before the city, and a
 * ZIP is appended only when the short form names more than one property.
 *
 * Path rule shared with the search routes (#350): the first segment is always `<city>-<st>`. A
 * two-segment path whose second segment starts with a digit is an address slug. A path that ends
 * in `homes-for-sale` or `homes-for-rent` is a search path (see `parseSearchPath`).
 *
 * The client builds a slug from structured geocoder fields, never from free text. The service
 * resolves a slug by the normalized parts below.
 */

/** USPS suffix abbreviations (C1 of Publication 28) for the forms that occur in DMV addresses. */
const STREET_SUFFIXES: Readonly<Record<string, string>> = {
  alley: 'aly',
  avenue: 'ave',
  av: 'ave',
  boulevard: 'blvd',
  circle: 'cir',
  court: 'ct',
  cove: 'cv',
  crescent: 'cres',
  drive: 'dr',
  expressway: 'expy',
  heights: 'hts',
  highway: 'hwy',
  lane: 'ln',
  loop: 'loop',
  parkway: 'pkwy',
  place: 'pl',
  plaza: 'plz',
  point: 'pt',
  road: 'rd',
  route: 'rte',
  square: 'sq',
  street: 'st',
  terrace: 'ter',
  trail: 'trl',
  turnpike: 'tpke',
  way: 'way',
};

const DIRECTIONALS: Readonly<Record<string, string>> = {
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
};

/**
 * Canonical street line for comparison: case-folded, punctuation-stripped, whitespace-collapsed,
 * with USPS suffixes and directionals abbreviated. `properties.address_key` hashes this value, so
 * a change here changes property identity.
 */
export function normalizeStreetLine(streetLine: string): string {
  return streetLine
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => DIRECTIONALS[token] ?? STREET_SUFFIXES[token] ?? token)
    .join(' ');
}

/** Lower case, every run of other characters becomes one hyphen. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A comparable place name: lower case, every run of other characters becomes one space. */
export function normalizePlaceName(text: string): string {
  return slugify(text).replace(/-/g, ' ');
}

/** A comparable unit designator: lower case, letters and digits only. */
export function normalizeUnit(unit: string): string {
  return unit.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface PropertyAddressParts {
  /** House number and street, for example `118 Baggett Place`. No unit designator. */
  readonly streetLine: string;
  readonly unitNumber: string | null;
  readonly city: string;
  readonly state: string;
  readonly zip: string | null;
}

export const SEARCH_PATH_SEGMENTS = ['homes-for-sale', 'homes-for-rent'] as const;

const CITY_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z]{2}$/;
const HOUSE_NUMBER = /^\d+[a-z]?$/;
const ZIP5 = /^\d{5}$/;
const UNIT_KEYWORDS = new Set(['unit', 'apt', 'suite', 'ste']);

export function citySegment(city: string, state: string): string {
  return `${slugify(city)}-${slugify(state)}`;
}

/** True when a second path segment is an address slug rather than a search segment. */
export function isAddressSegment(segment: string): boolean {
  return /^\d/.test(segment);
}

export function isCitySegment(segment: string): boolean {
  return CITY_SEGMENT.test(segment);
}

export function addressSegment(
  parts: PropertyAddressParts,
  options: { readonly withZip: boolean },
): string {
  const unit = parts.unitNumber === null ? '' : `-unit-${slugify(parts.unitNumber)}`;
  const zip = options.withZip && parts.zip !== null ? `-${parts.zip.slice(0, 5)}` : '';
  return `${slugify(parts.streetLine)}${unit}-${citySegment(parts.city, parts.state)}${zip}`;
}

export function propertyPath(
  parts: PropertyAddressParts,
  options: { readonly withZip: boolean },
): string {
  return `/${citySegment(parts.city, parts.state)}/${addressSegment(parts, options)}`;
}

export interface ParsedPropertyPath {
  readonly houseNumber: string;
  /** Street words after the house number, space-separated, lower case. */
  readonly street: string;
  readonly streetLine: string;
  readonly unitNumber: string | null;
  /** Lower-case city words, as `normalizePlaceName` yields them. */
  readonly city: string;
  readonly state: string;
  readonly zip: string | null;
}

/** Parses the two path segments. `null` when they do not form a property path. */
export function parsePropertyPath(citySeg: string, addressSeg: string): ParsedPropertyPath | null {
  const cityLower = citySeg.toLowerCase();
  const addressLower = addressSeg.toLowerCase();
  if (!isCitySegment(cityLower) || !isAddressSegment(addressLower)) return null;

  const cityTokens = cityLower.split('-');
  const tokens = addressLower.split('-').filter(Boolean);
  let zip: string | null = null;
  if (tokens.length > 0 && ZIP5.test(tokens[tokens.length - 1] as string)) {
    zip = tokens.pop() as string;
  }
  if (tokens.length < cityTokens.length + 2) return null;
  const tail = tokens.slice(tokens.length - cityTokens.length);
  if (tail.join('-') !== cityTokens.join('-')) return null;
  const head = tokens.slice(0, tokens.length - cityTokens.length);

  const houseNumber = head[0] as string;
  if (!HOUSE_NUMBER.test(houseNumber)) return null;

  let streetTokens = head.slice(1);
  let unitNumber: string | null = null;
  for (let i = streetTokens.length - 2; i >= 1; i -= 1) {
    if (UNIT_KEYWORDS.has(streetTokens[i] as string)) {
      unitNumber = streetTokens.slice(i + 1).join('-');
      streetTokens = streetTokens.slice(0, i);
      break;
    }
  }
  if (streetTokens.length === 0) return null;

  const street = streetTokens.join(' ');
  return {
    houseNumber,
    street,
    streetLine: `${houseNumber} ${street}`,
    unitNumber,
    city: cityTokens.slice(0, -1).join(' '),
    state: (cityTokens[cityTokens.length - 1] as string).toUpperCase(),
    zip,
  };
}

// ---------------------------------------------------------------------------------------------
// Search paths (#350)
// ---------------------------------------------------------------------------------------------

export type SearchPathSegment = (typeof SEARCH_PATH_SEGMENTS)[number];

/** A place that a search path names. A street or neighborhood always has a city+state parent. */
export type SearchPlace =
  | { readonly kind: 'city'; readonly city: string; readonly state: string }
  | { readonly kind: 'zip'; readonly zip: string; readonly city: string; readonly state: string }
  | {
      readonly kind: 'neighborhood' | 'street';
      /** The neighborhood or street name. */
      readonly name: string;
      readonly city: string;
      readonly state: string;
      readonly zip?: string | null;
    }
  | { readonly kind: 'county'; readonly county: string; readonly state: string };

export interface ParsedSearchPath {
  /** `null` for a map-area search (`/homes-for-sale?boundary=...`). */
  readonly place: SearchPlace | null;
  readonly segment: SearchPathSegment;
}

const COUNTY_SEGMENT = /^([a-z0-9]+(?:-[a-z0-9]+)*)-county-([a-z]{2})$/;
const NEIGHBORHOOD_SEGMENT = /^([a-z0-9]+(?:-[a-z0-9]+)*)-neighborhood$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A street's path segment: the name with USPS abbreviations, `king-st` for "King Street". */
export function streetSegment(street: string): string {
  return slugify(normalizeStreetLine(street));
}

/** Removes a trailing "County", so that the path is not `fairfax-county-county-va`. */
export function countyBaseName(county: string): string {
  return county.replace(/\s+county$/i, '').trim();
}

function words(slug: string): string {
  return slug.replace(/-/g, ' ');
}

/**
 * The search path for a place, with no trailing slash. Next.js sends the slash form to this form
 * with a 308. `null` gives the map-area path.
 */
export function searchPath(place: SearchPlace | null, segment: SearchPathSegment): string {
  if (place === null) return `/${segment}`;
  if (place.kind === 'county') {
    return `/${slugify(countyBaseName(place.county))}-county-${slugify(place.state)}/${segment}`;
  }
  const parts = [citySegment(place.city, place.state)];
  if (place.kind === 'zip') parts.push(place.zip.slice(0, 5));
  if (place.kind === 'neighborhood' || place.kind === 'street') {
    if (place.zip) parts.push(place.zip.slice(0, 5));
    parts.push(
      place.kind === 'street' ? streetSegment(place.name) : `${slugify(place.name)}-neighborhood`,
    );
  }
  return `/${parts.join('/')}/${segment}`;
}

/**
 * Parses search path segments. Names come back as lower-case words (`del ray`), because a slug
 * keeps nothing more. The page resolves them to real place names through the geocoder. `null`
 * when the segments are not a search path.
 */
export function parseSearchPath(segments: readonly string[]): ParsedSearchPath | null {
  const lower = segments.filter(Boolean).map((segment) => segment.toLowerCase());
  const segment = lower[lower.length - 1];
  if (segment === undefined || !(SEARCH_PATH_SEGMENTS as readonly string[]).includes(segment)) {
    return null;
  }
  const listingSegment = segment as SearchPathSegment;
  const head = lower.slice(0, -1);
  if (head.length === 0) return { place: null, segment: listingSegment };

  const first = head[0] as string;
  const county = COUNTY_SEGMENT.exec(first);
  if (county && head.length === 1) {
    const place: SearchPlace = {
      kind: 'county',
      county: words(county[1] as string),
      state: (county[2] as string).toUpperCase(),
    };
    return { place, segment: listingSegment };
  }
  if (!isCitySegment(first)) return null;
  const cityTokens = first.split('-');
  const city = cityTokens.slice(0, -1).join(' ');
  const state = (cityTokens[cityTokens.length - 1] as string).toUpperCase();

  let rest = head.slice(1);
  let zip: string | null = null;
  if (rest.length > 0 && ZIP5.test(rest[0] as string)) {
    zip = rest[0] as string;
    rest = rest.slice(1);
  }
  if (rest.length === 0) {
    const place: SearchPlace = zip
      ? { kind: 'zip', zip, city, state }
      : { kind: 'city', city, state };
    return { place, segment: listingSegment };
  }
  if (rest.length > 1) return null;
  // Second segment: ZIP (handled above), `<name>-neighborhood`, or else a street.
  const named = rest[0] as string;
  const neighborhood = NEIGHBORHOOD_SEGMENT.exec(named);
  if (neighborhood) {
    const name = words(neighborhood[1] as string);
    return { place: { kind: 'neighborhood', name, city, state, zip }, segment: listingSegment };
  }
  if (!SLUG.test(named) || ZIP5.test(named)) return null;
  return {
    place: { kind: 'street', name: words(named), city, state, zip },
    segment: listingSegment,
  };
}
