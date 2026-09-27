/**
 * `listings.neighborhood` holds Bright's raw `SubdivisionName`, and most of it is not a
 * neighborhood name (#390): an explicit "not on file" placeholder (however misspelled), a
 * digits/punctuation-only value ("000"), or an empty string once cleaned up. This module is the
 * ONE definition of "noise", used by:
 *
 *  - `normalizeNeighborhood()` — write-time cleanup. Called by the Bright mapper
 *    (`bright-map/map-record.ts`) for every incoming record, and by migration
 *    `1785801600037_normalize-neighborhood-values.js` once, for rows already stored.
 *  - `NEIGHBORHOOD_NOT_NOISE_SQL` — the same rule in SQL, applied by the neighborhoods aggregate
 *    query (`listings/repository.ts`) as a second, defensive gate. Write-time cleanup should
 *    already leave no noise in the column; this is belt-and-suspenders, never the only gate.
 *
 * `column` in `NEIGHBORHOOD_NOT_NOISE_SQL` must be a trusted, qualified column reference (e.g.
 * `v.neighborhood`) — it is interpolated into SQL text, never caller input.
 */

const NOISE_PATTERNS: readonly RegExp[] = [
  /^NONE\b/, // NONE, NONE AVAILABLE and its misspellings, NONE AVAIL, NONE RURAL
  /^N\/?A$/, // N/A, NA
  /^UNKNOWN$/,
  /^NOT ON (THE )?LIST$/,
  /^NOT IN A? ?DEVELOPMENT$/,
  /^NOT IN A? ?SUBDIVISION$/,
  /^[\d\s.,_/-]*$/, // digits/punctuation only, e.g. "000", "--", "."
];

/** True for a value that carries no real neighborhood, once trimmed and upper-cased. */
export function isNoiseNeighborhood(value: string): boolean {
  const upper = value.trim().toUpperCase();
  if (upper === '') return true;
  return NOISE_PATTERNS.some((pattern) => pattern.test(upper));
}

/**
 * Write-time cleanup: trim, collapse internal whitespace, strip wrapping quotes and a trailing
 * run of periods, then map a noise value to NULL.
 *
 * Deliberately never title-cases and never lower-cases: the raw variant's case is what the
 * neighborhoods query counts to pick the group's most frequent display form (`mode()` in the
 * aggregate query), and normalizing case here would erase that signal before it is counted.
 */
export function normalizeNeighborhood(raw: string | null): string | null {
  if (raw === null) return null;
  let value = raw.trim().replace(/\s+/g, ' ');
  value = value.replace(/^["']+|["']+$/g, '').trim();
  value = value.replace(/\.+$/, '').trim();
  if (value === '' || isNoiseNeighborhood(value)) return null;
  return value;
}

/**
 * The same noise rule as `isNoiseNeighborhood()`, as a SQL boolean expression that is TRUE when
 * `column` is real — i.e. NOT NULL and not noise. `~*` is Postgres's case-insensitive regex match,
 * so this mirrors `isNoiseNeighborhood()`'s upper-cased comparison without calling `upper()`
 * per-pattern.
 */
export function neighborhoodNotNoiseSql(column: string): string {
  return `(
    ${column} IS NOT NULL
    AND trim(${column}) <> ''
    AND ${column} !~* '^NONE'
    AND ${column} !~* '^N/?A$'
    AND ${column} !~* '^UNKNOWN$'
    AND ${column} !~* '^NOT ON (THE )?LIST$'
    AND ${column} !~* '^NOT IN A? ?DEVELOPMENT$'
    AND ${column} !~* '^NOT IN A? ?SUBDIVISION$'
    AND ${column} !~ '^[0-9\\s.,_/-]*$'
  )`;
}
