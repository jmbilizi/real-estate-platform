import {
  marketStatusSchema,
  normalizePlaceName,
  normalizeStreetLine,
  normalizeUnit,
  type ParsedPropertyPath,
  parsePropertyPath,
  type PropertyMatch,
  type PropertyPage,
  propertyPageSchema,
  propertyPath,
  type PropertyRecord,
  propertyRecordSchema,
} from '@cribstop/property-contracts';
import {
  findAddressCandidates,
  findListingById,
  findPropertyRecord,
  type PropertyRecordDbRow,
  type ReadClient,
} from './repository';

/**
 * The property page (#349). `listing_detail_v` decides the market status and whether listing data
 * may show. This module only assembles the response and resolves an address path to listings.
 */

function toNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

export function toPropertyRecord(row: PropertyRecordDbRow): PropertyRecord {
  return propertyRecordSchema.parse({
    propertyId: row.property_id,
    listingId: row.id,
    address:
      row.address_street === null
        ? null
        : `${row.address_street}${row.unit_number === null ? '' : ` ${row.unit_number}`}`,
    unitNumber: row.unit_number,
    city: row.city,
    state: row.state,
    zip: row.zip,
    propertyType: row.property_type,
    beds: row.beds,
    baths: toNumber(row.baths),
    sqft: row.sqft,
    lotSqft: row.lot_sqft,
    yearBuilt: row.year_built,
    source: row.source,
    isSample: row.is_sample,
  });
}

/** Compared in slug form, so `O'Donnell` and `118-120` match the path that slugify built. */
function slugStreet(streetLine: string): string {
  return normalizeStreetLine(normalizePlaceName(streetLine));
}

function sameStreet(row: PropertyRecordDbRow, parsed: ParsedPropertyPath): boolean {
  return (
    row.address_street !== null &&
    normalizePlaceName(row.city) === parsed.city &&
    (parsed.zip === null || row.zip === parsed.zip) &&
    slugStreet(row.address_street) === slugStreet(parsed.streetLine)
  );
}

/**
 * A path with a unit matches that unit. A path with no unit matches the whole-property listings,
 * and falls back to every unit only when the address has no whole-property listing.
 */
function atAddress(
  rows: readonly PropertyRecordDbRow[],
  parsed: ParsedPropertyPath,
): PropertyRecordDbRow[] {
  const street = rows.filter((row) => sameStreet(row, parsed));
  const unit = parsed.unitNumber;
  if (unit !== null) {
    return street.filter(
      (row) => row.unit_number !== null && normalizeUnit(row.unit_number) === normalizeUnit(unit),
    );
  }
  const whole = street.filter((row) => row.unit_number === null);
  return whole.length > 0 ? whole : street;
}

function lastUpdatedMs(row: PropertyRecordDbRow): number {
  return new Date(row.last_updated).getTime();
}

/** Displayable listings first, then the most recently updated. */
function preferred(a: PropertyRecordDbRow, b: PropertyRecordDbRow): number {
  if (a.listing_data_displayable !== b.listing_data_displayable) {
    return a.listing_data_displayable ? -1 : 1;
  }
  return lastUpdatedMs(b) - lastUpdatedMs(a);
}

/** One row per property and unit at the parsed address: its current listing. */
export async function resolveAddress(
  pool: ReadClient,
  parsed: ParsedPropertyPath,
): Promise<PropertyRecordDbRow[]> {
  const candidates = await findAddressCandidates(pool, {
    city: parsed.city,
    state: parsed.state,
    houseNumber: parsed.houseNumber,
    zip: parsed.zip,
  });
  const best = new Map<string, PropertyRecordDbRow>();
  for (const row of atAddress(candidates, parsed)) {
    const key = `${row.property_id}|${row.unit_id ?? ''}`;
    const held = best.get(key);
    if (held === undefined || preferred(row, held) < 0) best.set(key, row);
  }
  return [...best.values()].sort(preferred);
}

function pathOf(row: PropertyRecordDbRow, withZip: boolean): string | null {
  if (row.address_street === null) return null;
  return propertyPath(
    {
      streetLine: row.address_street,
      unitNumber: row.unit_number,
      city: row.city,
      state: row.state,
      zip: row.zip,
    },
    { withZip },
  );
}

/**
 * The address URL of one listing. The ZIP is added only when the short form names more than one
 * property. `null` when the seller withheld the address, when the street line has no house number,
 * or when the address resolves to a different listing (a rental beside a sale, an older listing).
 * A null path keeps `/listing/<id>` as that listing's URL.
 */
export async function canonicalPathFor(
  pool: ReadClient,
  row: PropertyRecordDbRow,
): Promise<string | null> {
  const short = pathOf(row, false);
  if (short === null) return null;
  const [, citySeg, addressSeg] = short.split('/');
  const parsed = parsePropertyPath(citySeg ?? '', addressSeg ?? '');
  if (parsed === null) return null;
  const places = await resolveAddress(pool, parsed);
  if (!places.some((place) => place.id === row.id)) return null;
  if (places.length === 1) return short;
  const withZip = parsePropertyPath(citySeg ?? '', `${addressSeg ?? ''}-${row.zip.slice(0, 5)}`);
  if (withZip === null) return null;
  const zipPlaces = await resolveAddress(pool, withZip);
  return zipPlaces.length === 1 && zipPlaces[0]?.id === row.id ? pathOf(row, true) : null;
}

/** The property page for one listing id, or `null` for the one frozen 404. */
export async function findPropertyPage(pool: ReadClient, id: string): Promise<PropertyPage | null> {
  const row = await findPropertyRecord(pool, id);
  if (row === null) return null;
  // The two reads are separate statements, so a sync can change the row between them. A listing
  // that left the search view in between renders as Off market, never with stale listing data.
  const detail = row.listing_data_displayable ? await findListingById(pool, id) : null;
  const displayable = detail !== null;
  return propertyPageSchema.parse({
    marketStatus: displayable ? marketStatusSchema.parse(row.market_status) : 'Off market',
    listingDataDisplayable: displayable,
    path: await canonicalPathFor(pool, row),
    propertyRecord: toPropertyRecord(row),
    detail,
  });
}

export interface AddressFetcher {
  /** Reads one address from the MLS across all statuses and stores what maps. */
  fetchAddress(parsed: ParsedPropertyPath): Promise<void>;
}

export type LookupResult =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'found'; readonly matches: PropertyMatch[] };

function toMatch(row: PropertyRecordDbRow, withZip: boolean): PropertyMatch | null {
  const path = pathOf(row, withZip);
  const record = toPropertyRecord(row);
  if (path === null || record.address === null) return null;
  return {
    listingId: row.id,
    path,
    address: record.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    marketStatus: marketStatusSchema.parse(row.market_status),
  };
}

/** Resolves the two path segments. On a local miss, reads the address from the MLS once. */
export async function lookupProperty(
  pool: ReadClient,
  segments: { readonly city: string; readonly address: string },
  fetcher?: AddressFetcher,
): Promise<LookupResult> {
  const parsed = parsePropertyPath(segments.city, segments.address);
  if (parsed === null) return { kind: 'invalid' };
  let rows = await resolveAddress(pool, parsed);
  if (rows.length === 0 && fetcher !== undefined) {
    await fetcher.fetchAddress(parsed);
    rows = await resolveAddress(pool, parsed);
  }
  const withZip = parsed.zip !== null || rows.length > 1;
  const matches = rows
    .map((row) => toMatch(row, withZip))
    .filter((match): match is PropertyMatch => match !== null);
  return matches.length === 0 ? { kind: 'not-found' } : { kind: 'found', matches };
}
