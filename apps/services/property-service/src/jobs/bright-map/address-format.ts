/**
 * Display-ready address parts from a Bright record (pure).
 *
 * `UnparsedAddress` is unreliable on the production feed (measured 2026-09-23): sometimes a full
 * `"6901 Chippewa Dr, Baltimore, MD 21209-1436, United States"`, sometimes a bare `"MD,FREDERICK"`
 * with no street at all. The structured parts are always present and upper case — `StreetNumber`
 * `"141"`, `StreetName` `"ASHTON"`, `StreetSuffix` `"COURT"` — so the street line is composed from
 * them in normal case with the USPS suffix abbreviation (`141 Ashton Ct`). `UnparsedAddress` is the
 * fallback only when the parts are missing.
 */

/** USPS Publication 28 standard suffix abbreviations, for the suffixes this feed writes in full. */
const SUFFIX_ABBREVIATIONS: Readonly<Record<string, string>> = {
  ALLEY: 'Aly',
  AVENUE: 'Ave',
  BOULEVARD: 'Blvd',
  BRANCH: 'Br',
  BRIDGE: 'Brg',
  CIRCLE: 'Cir',
  COURT: 'Ct',
  COVE: 'Cv',
  CRESCENT: 'Cres',
  CROSSING: 'Xing',
  DRIVE: 'Dr',
  EXPRESSWAY: 'Expy',
  EXTENSION: 'Ext',
  GARDENS: 'Gdns',
  GLEN: 'Gln',
  GREEN: 'Grn',
  GROVE: 'Grv',
  HEIGHTS: 'Hts',
  HIGHWAY: 'Hwy',
  HILL: 'Hl',
  HOLLOW: 'Holw',
  JUNCTION: 'Jct',
  LANDING: 'Lndg',
  LANE: 'Ln',
  MANOR: 'Mnr',
  MEADOWS: 'Mdws',
  MOUNT: 'Mt',
  MOUNTAIN: 'Mtn',
  PARKWAY: 'Pkwy',
  PLACE: 'Pl',
  PLAZA: 'Plz',
  POINT: 'Pt',
  RIDGE: 'Rdg',
  ROAD: 'Rd',
  SQUARE: 'Sq',
  STREET: 'St',
  TERRACE: 'Ter',
  TRACE: 'Trce',
  TRAIL: 'Trl',
  TURNPIKE: 'Tpke',
  VIEW: 'Vw',
  VILLAGE: 'Vlg',
};

/** Directionals keep their standard upper-case abbreviation. */
const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** `"WEST DEPTFORD TWP"` → `"West Deptford Twp"`. Letters after a space, hyphen or `'` are raised. */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s\-'/])([a-z])/g,
      (_, lead: string, letter: string) => lead + letter.toUpperCase(),
    );
}

function directional(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const upper = value.toUpperCase();
  return DIRECTIONALS.has(upper) ? upper : titleCase(value);
}

function suffix(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return SUFFIX_ABBREVIATIONS[value.toUpperCase()] ?? titleCase(value);
}

/**
 * The street line without the unit, or `null` when the record carries no street number and name.
 * The unit is kept apart because it is the `units` table's to hold (`UnitNumber`).
 */
export function composeStreetLine(payload: Readonly<Record<string, unknown>>): string | null {
  const number = text(payload.StreetNumber);
  const name = text(payload.StreetName);
  if (number === null || name === null) {
    return null;
  }
  return [
    number,
    directional(text(payload.StreetDirPrefix)),
    titleCase(name),
    suffix(text(payload.StreetSuffix)),
    directional(text(payload.StreetDirSuffix)),
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}
