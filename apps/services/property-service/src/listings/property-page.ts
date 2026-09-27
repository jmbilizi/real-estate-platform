import {
  type ListingCardRow,
  type ListingDetail,
  type MarketStatus,
  marketStatusSchema,
  normalizePlaceName,
  normalizeStreetLine,
  normalizeUnit,
  type ParsedPropertyPath,
  parsePropertyPath,
  type PropertyHistoryEntry,
  propertyHistoryEntrySchema,
  type PropertyMatch,
  type PropertyPage,
  propertyPagePath,
  propertyPageSchema,
  type PropertyRecord,
  propertyRecordSchema,
  type PropertySeo,
  propertySlug,
  searchRequestSchema,
} from '@cribstop/property-contracts';
import {
  findAddressCandidates,
  findHistoryFacts,
  findHomeRows,
  findListingById,
  findPropertyRecord,
  type HistoryFactsDbRow,
  type PropertyRecordDbRow,
  type ReadClient,
  type ReadPool,
  searchListings,
} from './repository';

/**
 * The property page (#382). `listing_detail_v` decides the market status and whether listing data
 * may show, and `listing_search_v` decides every listing field. This module only selects the
 * latest listing, assembles the response and resolves an address path to a home.
 */

const NEARBY_LIMIT = 8;
/** Half the side of the nearby search square, in degrees. About 2 km in the DMV. */
const NEARBY_HALF_SIDE = 0.02;
const LIVE_STATUSES: ReadonlySet<string> = new Set([
  'Active',
  'Coming Soon',
  'Under Contract',
  'Pending',
]);

function toNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function instant(value: Date | string): string {
  return new Date(value).toISOString();
}

export function homeIdOf(row: Pick<PropertyRecordDbRow, 'property_id' | 'unit_id'>): string {
  return row.unit_id ?? row.property_id;
}

export function toPropertyRecord(row: PropertyRecordDbRow): PropertyRecord {
  return propertyRecordSchema.parse({
    propertyId: row.property_id,
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

/**
 * The listing the page is about. A live listing wins, because the sync can touch a stale
 * duplicate after it. Otherwise the most recent listing decides, Off market included.
 * `rows` is newest first.
 */
export function latestOf(rows: readonly PropertyRecordDbRow[]): PropertyRecordDbRow | null {
  return (
    rows.find((row) => row.listing_data_displayable && LIVE_STATUSES.has(row.market_status)) ??
    rows[0] ??
    null
  );
}

function pageAddress(row: PropertyRecordDbRow) {
  return {
    streetLine: row.address_street,
    unitNumber: row.address_street === null ? null : row.unit_number,
    city: row.city,
    state: row.state,
  };
}

function toHistoryEntry(
  row: PropertyRecordDbRow,
  facts: HistoryFactsDbRow,
): PropertyHistoryEntry | null {
  const parsed = propertyHistoryEntrySchema.safeParse({
    listingId: row.id,
    marketStatus: row.market_status,
    listingType: facts.listing_type,
    price: facts.price === null ? null : Number(facts.price),
    closePrice: facts.close_price === null ? null : Number(facts.close_price),
    closeDate: facts.close_date,
    lastUpdated: instant(facts.last_updated),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Past listings whose data may display. The facts come from `listing_search_v`, so a withdrawn,
 * expired or canceled listing, or a sale outside the sold rule, has no facts and is left out.
 * On a page that shows the address, a listing whose seller withheld the address is left out too:
 * its price and date must not be tied to the address.
 */
async function historyOf(
  pool: ReadClient,
  rows: readonly PropertyRecordDbRow[],
  latest: PropertyRecordDbRow,
): Promise<PropertyHistoryEntry[]> {
  const pageShowsAddress = latest.address_street !== null;
  const past = rows.filter(
    (row) =>
      row.id !== latest.id &&
      row.listing_data_displayable &&
      (!pageShowsAddress || row.address_street !== null),
  );
  const facts = new Map(
    (
      await findHistoryFacts(
        pool,
        past.map((row) => row.id),
      )
    ).map((fact) => [fact.id, fact]),
  );
  return past
    .map((row) => {
      const fact = facts.get(row.id);
      return fact === undefined ? null : toHistoryEntry(row, fact);
    })
    .filter((entry): entry is PropertyHistoryEntry => entry !== null);
}

function square(latitude: number, longitude: number): string {
  const d = NEARBY_HALF_SIDE;
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [longitude - d, latitude - d],
        [longitude + d, latitude - d],
        [longitude + d, latitude + d],
        [longitude - d, latitude + d],
        [longitude - d, latitude - d],
      ],
    ],
  });
}

/** Other active listings near the home: a square around its point, else its city. */
async function nearbyOf(
  pool: ReadPool,
  homeId: string,
  latest: PropertyRecordDbRow,
  detail: ListingDetail | null,
): Promise<ListingCardRow[]> {
  const listing = detail?.listing ?? null;
  const place =
    listing !== null && listing.latitude !== null && listing.longitude !== null
      ? { boundary: square(listing.latitude, listing.longitude) }
      : { city: latest.city, state: latest.state };
  const envelope = await searchListings(
    pool,
    searchRequestSchema.parse({
      ...place,
      listingType: listing?.listingType === 'rent' ? 'rent' : 'sale',
      status: 'Active',
      sort: 'newest',
      pageSize: String(NEARBY_LIMIT + 1),
    }),
  );
  return envelope.results.filter((card) => card.homeId !== homeId).slice(0, NEARBY_LIMIT);
}

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usd = (value: number): string => `$${WHOLE.format(value)}`;

function statusLead(marketStatus: MarketStatus, detail: ListingDetail | null): string {
  const listing = detail?.listing ?? null;
  if (listing === null) return 'Not listed for sale or rent now';
  if (marketStatus === 'Sold') {
    return listing.closePrice === null ? 'Sold' : `Sold for ${usd(listing.closePrice)}`;
  }
  const offer = listing.listingType === 'rent' ? 'for rent' : 'for sale';
  const price =
    listing.price === null
      ? ''
      : ` at ${usd(listing.price)}${listing.listingType === 'rent' ? '/mo' : ''}`;
  return `${marketStatus} ${offer}${price}`;
}

/** SEO text from the same facts the page shows, so it never says more than the page. */
export function seoOf(
  record: PropertyRecord,
  marketStatus: MarketStatus,
  detail: ListingDetail | null,
): PropertySeo {
  const place = `${record.city}, ${record.state} ${record.zip}`;
  const title = record.address === null ? `Home in ${place}` : `${record.address}, ${place}`;
  const facts = [
    record.beds === null ? null : `${record.beds} bd`,
    record.baths === null ? null : `${record.baths} ba`,
    record.sqft === null ? null : `${WHOLE.format(record.sqft)} sq ft`,
  ].filter((fact): fact is string => fact !== null);
  const home = `${facts.length > 0 ? `${facts.join(', ')} ` : ''}${record.propertyType}`;
  return {
    title,
    description: `${statusLead(marketStatus, detail)}. ${home} in ${record.city}, ${record.state}.`,
  };
}

/** The whole property page of one home, or `null` for the one frozen 404. */
export async function findHomePage(pool: ReadPool, homeId: string): Promise<PropertyPage | null> {
  const rows = await findHomeRows(pool, homeId);
  const latest = latestOf(rows);
  if (latest === null) return null;
  // The reads are separate statements, so a sync can change the row between them. A listing that
  // left the search view in between renders as Off market, never with stale listing data.
  const detail = latest.listing_data_displayable ? await findListingById(pool, latest.id) : null;
  const displayable = detail !== null;
  const marketStatus = displayable ? marketStatusSchema.parse(latest.market_status) : 'Off market';
  const record = toPropertyRecord(latest);
  const [history, nearby] = await Promise.all([
    historyOf(pool, rows, latest),
    nearbyOf(pool, homeId, latest, detail),
  ]);
  return propertyPageSchema.parse({
    homeId,
    propertyId: latest.property_id,
    unitId: latest.unit_id,
    slug: propertySlug(pageAddress(latest)),
    canonicalPath: propertyPagePath(pageAddress(latest), homeId),
    marketStatus,
    listingDataDisplayable: displayable,
    seo: seoOf(record, marketStatus, detail),
    propertyRecord: record,
    latestListing: detail,
    history,
    nearby,
  });
}

/** The page of the home one listing is on. `null` for the one frozen 404. */
export async function findListingHomePage(
  pool: ReadPool,
  listingId: string,
): Promise<PropertyPage | null> {
  const row = await findPropertyRecord(pool, listingId);
  return row === null ? null : findHomePage(pool, homeIdOf(row));
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

/** One row per home at the parsed address: its current listing. */
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
    const key = homeIdOf(row);
    const held = best.get(key);
    if (held === undefined || preferred(row, held) < 0) best.set(key, row);
  }
  return [...best.values()].sort(preferred);
}

export interface AddressFetcher {
  /** Reads one address from the MLS across all statuses and stores what maps. */
  fetchAddress(parsed: ParsedPropertyPath): Promise<void>;
}

export type LookupResult =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'found'; readonly matches: PropertyMatch[] };

function toMatch(row: PropertyRecordDbRow): PropertyMatch | null {
  const record = toPropertyRecord(row);
  if (record.address === null) return null;
  const homeId = homeIdOf(row);
  return {
    homeId,
    path: propertyPagePath(pageAddress(row), homeId),
    address: record.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    marketStatus: marketStatusSchema.parse(row.market_status),
  };
}

/** Resolves the two #349 path segments. On a local miss, reads the address from the MLS once. */
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
  const matches = rows
    .map((row) => toMatch(row))
    .filter((match): match is PropertyMatch => match !== null);
  return matches.length === 0 ? { kind: 'not-found' } : { kind: 'found', matches };
}
