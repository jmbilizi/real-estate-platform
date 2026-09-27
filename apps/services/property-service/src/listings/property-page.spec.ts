import request from 'supertest';

import { createApp } from '../app';
import {
  type AddressFetcher,
  findHomePage,
  findListingHomePage,
  lookupProperty,
} from './property-page';
import type { HistoryFactsDbRow, PropertyRecordDbRow, ReadPool } from './repository';
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

const NEARBY_PROPERTY_ID = '018f2f2a-6d1b-7c3d-8b2e-000000000020';

/**
 * Answers each statement this module issues. `detailVisible` is what `listing_search_v` holds
 * for the latest listing. `home` is every `listing_detail_v` row of the home.
 */
function fakePool(options: {
  record: PropertyRecordDbRow | null;
  home?: PropertyRecordDbRow[];
  candidates?: PropertyRecordDbRow[];
  detailVisible: boolean;
  historyFacts?: HistoryFactsDbRow[];
}): ReadPool & { statements: string[] } {
  const statements: string[] = [];
  const self = options.record === null ? [] : [options.record];
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    statements.push(text);
    let rows: unknown[] = [];
    if (text.includes('FROM listing_detail_v d WHERE d.id')) {
      rows = self;
    } else if (text.includes('d.unit_id = $1 OR')) {
      rows = options.home ?? self;
    } else if (text.includes('FROM listing_detail_v d')) {
      rows = options.candidates ?? self;
    } else if (text.includes('v.id = ANY')) {
      rows = options.historyFacts ?? [];
    } else if (text.includes('JOIN properties p ON p.id = v.property_id')) {
      rows = options.detailVisible ? [cardDbRowFixture({ media: null, open_houses: null })] : [];
    } else if (text.includes('count(*)::int AS total')) {
      rows = [{ total: 2 }];
    } else if (text.includes('FROM listing_search_v v')) {
      rows = [
        cardDbRowFixture(),
        cardDbRowFixture({
          id: '018f2f2a-6d1b-7c3d-8b2e-000000000021',
          property_id: NEARBY_PROPERTY_ID,
        }),
      ];
    }
    return Promise.resolve({ rows: rows as T[] });
  };
  return { statements, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

describe('findHomePage: status by status (#382)', () => {
  it.each(['Active', 'Coming Soon', 'Under Contract', 'Pending', 'Sold'] as const)(
    '%s shows the latest listing with that status',
    async (status) => {
      const pool = fakePool({ record: recordRow({ market_status: status }), detailVisible: true });

      const page = await findHomePage(pool, PROPERTY_ID);

      expect(page?.marketStatus).toBe(status);
      expect(page?.listingDataDisplayable).toBe(true);
      expect(page?.latestListing).not.toBeNull();
      expect(page?.slug).toBe('118-baggett-pl-alexandria-va');
      expect(page?.canonicalPath).toBe(`/property/118-baggett-pl-alexandria-va/${PROPERTY_ID}`);
      expect(page?.seo.title).toBe('118 Baggett Pl, Alexandria, VA 22314');
    },
  );

  it.each(['Withdrawn', 'Expired', 'Canceled', 'Hold', 'Off Market', 'Sold outside the rule'])(
    '%s shows only the address, Off market and the property record',
    async () => {
      const pool = fakePool({
        record: recordRow({ market_status: 'Off market', listing_data_displayable: false }),
        detailVisible: false,
      });

      const page = await findHomePage(pool, PROPERTY_ID);

      expect(page).toMatchObject({
        marketStatus: 'Off market',
        listingDataDisplayable: false,
        latestListing: null,
        history: [],
        propertyRecord: { address: '118 Baggett Pl', beds: 3, baths: 2.5, sqft: 1800 },
      });
      const { nearby: _nearby, seo: _seo, ...own } = page ?? {};
      expect(JSON.stringify(own)).not.toMatch(/price|media|description|broker|agent/i);
      expect(page?.seo.description).toBe(
        'Not listed for sale or rent now. 3 bd, 2.5 ba, 1,800 sq ft Townhome in Alexandria, VA.',
      );
    },
  );

  it('renders Off market when the listing leaves the search view between the two reads', async () => {
    const pool = fakePool({
      record: recordRow({ market_status: 'Pending' }),
      detailVisible: false,
    });

    const page = await findHomePage(pool, PROPERTY_ID);

    expect(page?.marketStatus).toBe('Off market');
    expect(page?.latestListing).toBeNull();
  });

  it('gives a city-only slug when the seller withheld the address', async () => {
    const pool = fakePool({
      record: recordRow({
        address_street: null,
        market_status: 'Off market',
        listing_data_displayable: false,
      }),
      detailVisible: false,
    });

    const page = await findHomePage(pool, PROPERTY_ID);

    expect(page?.canonicalPath).toBe(`/property/alexandria-va/${PROPERTY_ID}`);
    expect(page?.propertyRecord.address).toBeNull();
    expect(page?.seo.title).toBe('Home in Alexandria, VA 22314');
  });

  it('puts the unit after the city and keys the page on the unit id', async () => {
    const unitId = '018f2f2a-6d1b-7c3d-8b2e-000000000010';
    const pool = fakePool({
      record: recordRow({ unit_id: unitId, unit_number: 'A4' }),
      detailVisible: true,
    });

    const page = await findHomePage(pool, unitId);

    expect(page).toMatchObject({ homeId: unitId, propertyId: PROPERTY_ID, unitId });
    expect(page?.canonicalPath).toBe(`/property/118-baggett-pl-alexandria-va-unit-a4/${unitId}`);
  });

  it('masks the whole page when any listing of the home withheld the address', async () => {
    const withheld = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000033',
      address_street: null,
      market_status: 'Off market',
      listing_data_displayable: false,
      last_updated: '2020-01-01T00:00:00.000Z',
    });
    const pool = fakePool({
      record: recordRow(),
      home: [recordRow(), withheld],
      detailVisible: true,
    });

    const page = await findHomePage(pool, PROPERTY_ID);

    expect(page?.canonicalPath).toBe(`/property/alexandria-va/${PROPERTY_ID}`);
    expect(page?.propertyRecord.address).toBeNull();
    expect(page?.latestListing?.listing.address).toBeNull();
    expect(page?.latestListing?.listing.latitude).toBeNull();
    expect(JSON.stringify(page)).not.toContain('Baggett');
  });

  it('keys the page on a lower-case id', async () => {
    const pool = fakePool({ record: recordRow(), detailVisible: true });

    expect((await findHomePage(pool, PROPERTY_ID.toUpperCase()))?.homeId).toBe(PROPERTY_ID);
  });

  it('a live listing wins over a newer Off market duplicate', async () => {
    const stale = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000007',
      market_status: 'Off market',
      listing_data_displayable: false,
      last_updated: '2026-09-25T00:00:00.000Z',
    });
    const pool = fakePool({ record: recordRow(), home: [stale, recordRow()], detailVisible: true });

    expect((await findHomePage(pool, PROPERTY_ID))?.marketStatus).toBe('Active');
  });

  it('history keeps only past listings that listing_search_v still shows', async () => {
    const sold = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000030',
      market_status: 'Sold',
      last_updated: '2025-05-01T00:00:00.000Z',
    });
    const withdrawn = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000031',
      market_status: 'Off market',
      listing_data_displayable: false,
      last_updated: '2024-05-01T00:00:00.000Z',
    });
    const masked = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000032',
      market_status: 'Sold',
      address_street: null,
      last_updated: '2023-05-01T00:00:00.000Z',
    });
    const pool = fakePool({
      record: recordRow(),
      home: [recordRow(), sold, withdrawn, masked],
      detailVisible: true,
      historyFacts: [
        {
          id: sold.id,
          listing_type: 'sold',
          price: 480000,
          close_price: 475000,
          close_date: '2025-04-30',
          last_updated: sold.last_updated,
        },
      ],
    });

    const page = await findHomePage(pool, PROPERTY_ID);

    expect(page?.history).toEqual([
      {
        listingId: sold.id,
        marketStatus: 'Sold',
        listingType: 'sold',
        price: 480000,
        closePrice: 475000,
        closeDate: '2025-04-30',
        lastUpdated: '2025-05-01T00:00:00.000Z',
      },
    ]);
    const asked = pool.statements.find((sql) => sql.includes('v.id = ANY'));
    expect(asked).toBeDefined();
  });

  it('nearby lists other homes only, each with its property path', async () => {
    const pool = fakePool({ record: recordRow(), detailVisible: true });

    const page = await findHomePage(pool, PROPERTY_ID);

    expect(page?.nearby.map((card) => card.homeId)).toEqual([NEARBY_PROPERTY_ID]);
    expect(page?.nearby[0]?.propertyPath).toBe(
      `/property/900-king-st-alexandria-va/${NEARBY_PROPERTY_ID}`,
    );
  });

  it('returns null for an unknown, deleted or suppressed id', async () => {
    expect(
      await findHomePage(fakePool({ record: null, detailVisible: false }), PROPERTY_ID),
    ).toBeNull();
    expect(
      await findListingHomePage(fakePool({ record: null, detailVisible: false }), LISTING_ID),
    ).toBeNull();
  });

  it('a listing id resolves to the page of its home', async () => {
    const pool = fakePool({ record: recordRow(), detailVisible: true });

    expect((await findListingHomePage(pool, LISTING_ID))?.homeId).toBe(PROPERTY_ID);
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
          homeId: PROPERTY_ID,
          path: `/property/118-baggett-pl-alexandria-va/${PROPERTY_ID}`,
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

  it('ambiguous: two ZIPs give two matches, each with its own property path', async () => {
    const other = recordRow({
      id: '018f2f2a-6d1b-7c3d-8b2e-000000000009',
      property_id: '018f2f2a-6d1b-7c3d-8b2e-000000000008',
      zip: '22301',
    });
    const pool = fakePool({ record: null, candidates: [recordRow(), other], detailVisible: false });

    const result = await lookupProperty(pool, segments);

    expect(result.kind === 'found' && result.matches.map((m) => m.path)).toEqual([
      `/property/118-baggett-pl-alexandria-va/${PROPERTY_ID}`,
      '/property/118-baggett-pl-alexandria-va/018f2f2a-6d1b-7c3d-8b2e-000000000008',
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

describe('routes (#382)', () => {
  it('GET /listings/:id/page and /properties/:id/page answer 200, and the frozen 404 for a bad id', async () => {
    const pool = fakePool({
      record: recordRow({ market_status: 'Off market', listing_data_displayable: false }),
      detailVisible: false,
    });
    const app = createApp({ pool, galleryLoader: { loadGallery: async () => 'skipped' } });

    const ok = await request(app).get(`/listings/${LISTING_ID}/page`).expect(200);
    expect(ok.body.marketStatus).toBe('Off market');
    await request(app).get('/listings/not-a-uuid/page').expect(404);
    const home = await request(app).get(`/properties/${PROPERTY_ID}/page`).expect(200);
    expect(home.body.canonicalPath).toBe(ok.body.canonicalPath);
    await request(app).get('/properties/not-a-uuid/page').expect(404);
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
