import request from 'supertest';

import { createApp } from '../app';
import { type AddressFetcher, findPropertyPage, lookupProperty } from './property-page';
import type { PropertyRecordDbRow, ReadPool } from './repository';
import { cardDbRowFixture } from './test-fixtures';

const LISTING_ID = '018f2f2a-6d1b-7c3d-8b2e-000000000001';
const PROPERTY_ID = '018f2f2a-6d1b-7c3d-8b2e-000000000002';

function recordRow(overrides: Partial<PropertyRecordDbRow> = {}): PropertyRecordDbRow {
  return {
    id: LISTING_ID,
    property_id: PROPERTY_ID,
    unit_id: null,
    listing_data_displayable: true,
    market_status: 'Active',
    address_street: '118 Baggett Pl',
    unit_number: null,
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    property_type: 'Townhome',
    beds: 3,
    baths: '2.5',
    sqft: 1800,
    lot_sqft: 1200,
    year_built: 1985,
    source: 'brightMLS',
    is_sample: false,
    last_updated: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * Answers the three statements this module issues: the record by id, the address candidates, and
 * the search-view detail. `detailVisible` is what `listing_search_v` would hold.
 */
function fakePool(options: {
  record: PropertyRecordDbRow | null;
  candidates?: PropertyRecordDbRow[];
  detailVisible: boolean;
}): ReadPool & { statements: string[] } {
  const statements: string[] = [];
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    statements.push(text);
    let rows: unknown[] = [];
    if (text.includes('FROM listing_detail_v d WHERE d.id')) {
      rows = options.record === null ? [] : [options.record];
    } else if (text.includes('FROM listing_detail_v d')) {
      rows = options.candidates ?? (options.record === null ? [] : [options.record]);
    } else if (text.includes('FROM listing_search_v v')) {
      rows = options.detailVisible ? [cardDbRowFixture({ media: null, open_houses: null })] : [];
    }
    return Promise.resolve({ rows: rows as T[] });
  };
  return { statements, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

describe('findPropertyPage: status by status (#349)', () => {
  it.each(['Active', 'Coming Soon', 'Under Contract', 'Pending', 'Sold'] as const)(
    '%s shows the listing detail with that status',
    async (status) => {
      const pool = fakePool({ record: recordRow({ market_status: status }), detailVisible: true });

      const page = await findPropertyPage(pool, LISTING_ID);

      expect(page?.marketStatus).toBe(status);
      expect(page?.listingDataDisplayable).toBe(true);
      expect(page?.detail).not.toBeNull();
      expect(page?.path).toBe('/alexandria-va/118-baggett-pl-alexandria-va');
    },
  );

  it.each(['Withdrawn', 'Expired', 'Canceled', 'Hold', 'Off Market', 'Sold outside the rule'])(
    '%s shows only the address, Off market and the property record',
    async () => {
      const pool = fakePool({
        record: recordRow({ market_status: 'Off market', listing_data_displayable: false }),
        detailVisible: false,
      });

      const page = await findPropertyPage(pool, LISTING_ID);

      expect(page).toMatchObject({
        marketStatus: 'Off market',
        listingDataDisplayable: false,
        detail: null,
        propertyRecord: {
          address: '118 Baggett Pl',
          beds: 3,
          baths: 2.5,
          sqft: 1800,
          yearBuilt: 1985,
        },
      });
      expect(JSON.stringify(page)).not.toMatch(/price|media|description|broker|agent/i);
      // The search view is never read for an Off market row.
      expect(pool.statements.some((sql) => sql.includes('FROM listing_search_v v'))).toBe(false);
    },
  );

  it('renders Off market when the listing leaves the search view between the two reads', async () => {
    const pool = fakePool({
      record: recordRow({ market_status: 'Pending' }),
      detailVisible: false,
    });

    const page = await findPropertyPage(pool, LISTING_ID);

    expect(page?.marketStatus).toBe('Off market');
    expect(page?.detail).toBeNull();
  });

  it('gives no address path when the seller withheld the address', async () => {
    const pool = fakePool({
      record: recordRow({
        address_street: null,
        market_status: 'Off market',
        listing_data_displayable: false,
      }),
      detailVisible: false,
    });

    const page = await findPropertyPage(pool, LISTING_ID);

    expect(page?.path).toBeNull();
    expect(page?.propertyRecord.address).toBeNull();
  });

  it('adds the ZIP to the path when the short form names two properties', async () => {
    const other = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000009',
      property_id: '018f2f2a-6d1b-7c3d-8b2e-000000000008',
      zip: '22301',
    });
    const pool = fakePool({
      record: recordRow(),
      candidates: [recordRow(), other],
      detailVisible: true,
    });

    const page = await findPropertyPage(pool, LISTING_ID);

    expect(page?.path).toBe('/alexandria-va/118-baggett-pl-alexandria-va-22314');
  });

  it('returns null for an unknown, deleted or suppressed id', async () => {
    expect(
      await findPropertyPage(fakePool({ record: null, detailVisible: false }), LISTING_ID),
    ).toBeNull();
  });
});

describe('lookupProperty (#349)', () => {
  const segments = { city: 'alexandria-va', address: '118-baggett-place-alexandria-va' };

  it('hit: matches Place against a stored Pl and returns the current listing', async () => {
    const older = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000007',
      market_status: 'Off market',
      listing_data_displayable: false,
      last_updated: '2020-01-01T00:00:00.000Z',
    });
    const pool = fakePool({ record: null, candidates: [older, recordRow()], detailVisible: true });
    const fetcher: AddressFetcher = { fetchAddress: jest.fn() };

    const result = await lookupProperty(pool, segments, fetcher);

    expect(result).toEqual({
      kind: 'found',
      matches: [
        {
          listingId: LISTING_ID,
          path: '/alexandria-va/118-baggett-pl-alexandria-va',
          address: '118 Baggett Pl',
          city: 'Alexandria',
          state: 'VA',
          zip: '22314',
          marketStatus: 'Active',
        },
      ],
    });
    expect(fetcher.fetchAddress).not.toHaveBeenCalled();
  });

  it('miss then MLS hit: reads the MLS once, then resolves again', async () => {
    const candidates: PropertyRecordDbRow[] = [];
    const pool = fakePool({ record: null, candidates, detailVisible: false });
    const fetcher: AddressFetcher = {
      fetchAddress: jest.fn(async () => {
        candidates.push(
          recordRow({ market_status: 'Off market', listing_data_displayable: false }),
        );
      }),
    };

    const result = await lookupProperty(pool, segments, fetcher);

    expect(fetcher.fetchAddress).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: 'found', matches: [{ marketStatus: 'Off market' }] });
  });

  it('miss everywhere: not found', async () => {
    const pool = fakePool({ record: null, candidates: [], detailVisible: false });
    const fetcher: AddressFetcher = { fetchAddress: jest.fn(async () => undefined) };

    expect(await lookupProperty(pool, segments, fetcher)).toEqual({ kind: 'not-found' });
  });

  it('does not match a different street at the same house number', async () => {
    const pool = fakePool({
      record: null,
      candidates: [recordRow({ address_street: '118 King St' })],
      detailVisible: false,
    });

    expect(await lookupProperty(pool, segments)).toEqual({ kind: 'not-found' });
  });

  it('ambiguous: two ZIPs give two matches with ZIP paths', async () => {
    const other = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000009',
      property_id: '018f2f2a-6d1b-7c3d-8b2e-000000000008',
      zip: '22301',
    });
    const pool = fakePool({ record: null, candidates: [recordRow(), other], detailVisible: false });

    const result = await lookupProperty(pool, segments);

    expect(result.kind === 'found' && result.matches.map((m) => m.path)).toEqual([
      '/alexandria-va/118-baggett-pl-alexandria-va-22314',
      '/alexandria-va/118-baggett-pl-alexandria-va-22301',
    ]);
  });

  it('rejects segments that are not a property path', async () => {
    const pool = fakePool({ record: null, detailVisible: false });
    expect(
      await lookupProperty(pool, { city: 'alexandria-va', address: 'homes-for-sale' }),
    ).toEqual({
      kind: 'invalid',
    });
  });
});

describe('routes (#349)', () => {
  it('GET /listings/:id/page answers 200 for Off market and the frozen 404 for a bad id', async () => {
    const pool = fakePool({
      record: recordRow({ market_status: 'Off market', listing_data_displayable: false }),
      detailVisible: false,
    });
    const app = createApp({ pool, galleryLoader: { loadGallery: async () => 'skipped' } });

    const ok = await request(app).get(`/listings/${LISTING_ID}/page`).expect(200);
    expect(ok.body.marketStatus).toBe('Off market');
    await request(app).get('/listings/not-a-uuid/page').expect(404);
  });

  it('GET /properties/lookup answers 400, 404 and 200', async () => {
    const pool = fakePool({ record: null, candidates: [recordRow()], detailVisible: true });
    const app = createApp({ pool, galleryLoader: { loadGallery: async () => 'skipped' } });

    await request(app).get('/properties/lookup').expect(400);
    await request(app)
      .get('/properties/lookup')
      .query({ city: 'alexandria-va', address: 'homes-for-sale' })
      .expect(400);
    await request(app)
      .get('/properties/lookup')
      .query({ city: 'alexandria-va', address: '999-baggett-place-alexandria-va' })
      .expect(404);
    const hit = await request(app)
      .get('/properties/lookup')
      .query({ city: 'alexandria-va', address: '118-baggett-place-alexandria-va' })
      .expect(200);
    expect(hit.body.matches).toHaveLength(1);
  });
});
