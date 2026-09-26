/**
 * Address parsing and canonicalisation for property identity.
 *
 * `properties.address_key` is the deduplication key that makes a second listing on the same address
 * attach to the SAME property instead of inventing a new building (PRD §6.2 requires MLS↔internal
 * deduplication). Getting it wrong is not a cosmetic problem: two rows for one home means two
 * accounts can each hold an approved `owner` claim on it (PRD §3.2).
 *
 * Lower-casing and stripping punctuation is NOT enough — '800 F Street NW' and '800 F St NW' are the
 * same building and must hash identically, so USPS street suffixes and directionals are expanded to a
 * canonical abbreviation first. This is a pragmatic normaliser, not CASS certification; the raw source
 * string is always retained in `properties.address_raw` so the key can be re-derived if this improves.
 *
 * Deliberately computed here rather than as a generated column: this is not an IMMUTABLE SQL
 * expression, and a generated column would freeze the algorithm into the schema.
 */

/** USPS suffix abbreviations (C1 of Publication 28) for the forms that occur in DMV addresses. */
const STREET_SUFFIXES: Record<string, string> = {
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

/** Directionals normalise to their compass abbreviation. */
const DIRECTIONALS: Record<string, string> = {
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
 * Unit designators as they appear in the dataset: "Unit 1201", "Apt 4", "Loft 3B", "PH1".
 * A penthouse marker carries no keyword, hence the third alternative.
 */
// The word boundary applies only to the keyword forms: '#' is not a word character, so a leading \b
// before the whole alternation would never match ' #202'.
const UNIT_DESIGNATOR_PATTERN =
  /\s*(?:\b(?:Unit|Apt|Apartment|Suite|Ste|Loft)\.?\s*([A-Za-z0-9-]+)|#\s*([A-Za-z0-9-]+)|\b(PH\d+[A-Za-z]?))\s*$/i;

export interface SplitAddress {
  /** The street line with any unit designator removed — what `properties.street_line` stores. */
  streetLine: string;
  /** The unit designator, or null when the address references no sub-unit. */
  unitNumber: string | null;
}

/**
 * Splits a display address into its street line and unit designator.
 *
 * The unit designator must not stay inside the street line: it belongs to the `units` row, and storing
 * it in both places is how one building ends up as two properties. A display address is composed back
 * from the two parts, never stored pre-joined.
 */
export function splitUnitDesignator(address: string): SplitAddress {
  const match = address.match(UNIT_DESIGNATOR_PATTERN);
  if (!match) {
    return { streetLine: address.trim(), unitNumber: null };
  }
  const unitNumber = match[1] ?? match[2] ?? match[3] ?? null;
  return {
    streetLine: address.slice(0, match.index).trim(),
    unitNumber,
  };
}

/**
 * Canonicalises a street line for hashing: case-folded, punctuation-stripped, whitespace-collapsed,
 * with USPS suffixes and directionals expanded to their standard abbreviation.
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

/**
 * Builds the deduplication key for one physical building.
 *
 * State is included because a street line and ZIP alone are not globally unique once the platform
 * leaves the DMV, and the platform is required to stay market-agnostic.
 */
export function buildAddressKey(input: {
  streetLine: string;
  state: string;
  zip5: string;
}): string {
  return [
    normalizeStreetLine(input.streetLine),
    input.state.trim().toLowerCase(),
    input.zip5.trim().slice(0, 5),
  ].join('|');
}
