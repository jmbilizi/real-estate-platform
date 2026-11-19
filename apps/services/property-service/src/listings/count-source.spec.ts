import { searchRequestSchema } from '@cribstop/property-contracts';
import { collapseCondition } from './collapse';
import { COUNT_COLUMNS, COUNT_SOURCE_SQL, countSource } from './count-source';
import { LISTING_VISIBILITY_SQL } from './columns';
import { getListingsMeta, type ReadPool, searchListings } from './repository';
import { buildSearchQuery } from './search-query';

/** One request per filter the count may carry. */
const LIGHT_FILTERS: Record<string, string>[] = [
  {},
  { listingType: 'sale', city: 'Bethesda', state: 'MD' },
  { listingType: 'sold' },
  { propertyType: 'Townhome,Single Family' },
  { status: 'Pending' },
  { zip: '20814' },
  { minPrice: '100000', maxPrice: '900000' },
  { beds: '2', baths: '2', minSqft: '900' },
  { neighborhood: 'Kensington' },
  { county: '24031' },
  { openHouse: 'true' },
  { newConstruction: 'true' },
  { waterfront: 'true', petFriendly: 'true' },
  { amenities: 'Waterfront,Pool' },
  { listedWithinDays: '7' },
  { priceReduced: 'true' },
  { officeKey: 'unlisted' },
];

const columnNames = new Set(COUNT_COLUMNS.map((column) => column.name));

function viewColumnsRead(where: string): string[] {
  return [...where.matchAll(/\bv\.([a-z_][a-z0-9_]*)/g)].map((match) => match[1] ?? '');
}

/** A pool whose client answers the count with 7 and every other statement with no rows. */
function fakePool(calls: { text: string; values?: unknown[] }[]): ReadPool {
  const client = {
    query: (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (/count\(\*\)::int AS total/i.test(text)) return Promise.resolve({ rows: [{ total: 7 }] });
      if (/listing_count/.test(text)) {
        return Promise.resolve({
          rows: [{ data_updated_at: null, sources: [], listing_count: 0, last_synced_at: null }],
        });
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  return { query: client.query, connect: () => Promise.resolve(client) } as unknown as ReadPool;
}

describe('the count source (#1050)', () => {
  it.each(LIGHT_FILTERS.map((query) => [JSON.stringify(query), query] as const))(
    'carries every column the WHERE reads for %s',
    (_label, query) => {
      const request = searchRequestSchema.parse(query);
      const { where } = buildSearchQuery(request);
      const missing = viewColumnsRead(where).filter((name) => !columnNames.has(name));
      expect(missing).toEqual([]);
      expect(countSource(request)).toBe(COUNT_SOURCE_SQL);
    },
  );

  it('carries every column the viewport filter reads', () => {
    const request = searchRequestSchema.parse({
      bounds: '38.9,-77.2,39.1,-77.0',
    });
    const { where } = buildSearchQuery(request);
    expect(viewColumnsRead(where).filter((name) => !columnNames.has(name))).toEqual([]);
  });

  it.each([
    { query: 'oak' },
    { street: 'Main' },
    { boundary: '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[0,0]]]}' },
  ])('counts through the view when the request carries %j', (query) => {
    expect(countSource(searchRequestSchema.parse(query))).toBe('listing_search_v v');
  });

  it('reads only listings, with the view row rule, and no join', () => {
    expect(COUNT_SOURCE_SQL).toContain('FROM listings l');
    expect(COUNT_SOURCE_SQL).toContain(LISTING_VISIBILITY_SQL.trim());
    expect(COUNT_SOURCE_SQL).not.toMatch(/\bJOIN\b/i);
    expect(COUNT_SOURCE_SQL).not.toContain('listing_search_v');
  });

  it('keeps the collapse condition in the count WHERE', () => {
    expect(buildSearchQuery(searchRequestSchema.parse({})).where).toContain(collapseCondition());
  });

  it('counts with the row query WHERE and params, and reads the page from the view', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    const request = searchRequestSchema.parse({ listingType: 'sale', city: 'Bethesda', beds: '2' });
    const { where, params } = buildSearchQuery(request);

    const envelope = await searchListings(fakePool(calls), request);

    const count = calls.find((call) => /count\(\*\)::int AS total/i.test(call.text));
    expect(count?.text).toContain(`FROM ${COUNT_SOURCE_SQL} WHERE ${where}`);
    expect(count?.values).toEqual(params);
    expect(calls.find((call) => /LIMIT \$\d+/.test(call.text))?.text).toContain(
      'FROM listing_search_v v',
    );
    expect(envelope.total).toBe(7);
  });

  it('counts a free-text search through the view', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];

    await searchListings(fakePool(calls), searchRequestSchema.parse({ query: 'oak' }));

    expect(calls.find((call) => /count\(\*\)::int AS total/i.test(call.text))?.text).toContain(
      'FROM listing_search_v v WHERE',
    );
  });
});

describe('getListingsMeta reads listings, not the view (#1050)', () => {
  it('uses the visibility predicate and no view join', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];

    await getListingsMeta(fakePool(calls));

    const text = calls.find((call) => /listing_count/.test(call.text))?.text ?? '';
    expect(text).toContain('FROM listings l');
    expect(text).toContain('l.deleted_at IS NULL');
    expect(text).not.toContain('listing_search_v');
  });
});
