import {
  type NeighborhoodsRequest,
  neighborhoodsRequestSchema,
} from '@cribstop/property-contracts';
import {
  getListingAttributes,
  getNeighborhoods,
  getPropertyAttributes,
  listBrightListingIdentities,
  type ReadClient,
} from './repository';

const baseNeighborhoodsRequest: NeighborhoodsRequest = neighborhoodsRequestSchema.parse({});

/**
 * `getListingAttributes()`/`getPropertyAttributes()` (#128) push the address-suppression decision
 * into the SQL statement itself, so there is no app-code filter step left to unit-test in
 * isolation — the guarantee IS the query text. These tests assert the query shape: the join/EXISTS
 * that derives visibility from `listing_search_v`, and the `is_address_bearing` gate, against a
 * fake `ReadClient` — no database, matching every other test in this file's siblings. Proving the
 * WHERE clause actually filters correctly needs a real Postgres and is out of this project's
 * DB-free unit-test scope; see the ticket for the outstanding integration/e2e step.
 */

function fakeClient(rows: unknown[] = []): {
  client: ReadClient;
  captured: { text: string; values: unknown[] }[];
} {
  const captured: { text: string; values: unknown[] }[] = [];
  const client: ReadClient = {
    query: <T>(text: string, values?: unknown[]) => {
      captured.push({ text, values: values ?? [] });
      return Promise.resolve({ rows: rows as T[] });
    },
  };
  return { client, captured };
}

describe('getListingAttributes', () => {
  it('joins listing_search_v on the listing itself, so suppression is derived, not passed in', async () => {
    const { client, captured } = fakeClient();

    await getListingAttributes(client, 'listing-1');

    const [query] = captured;
    expect(query?.text).toContain('FROM listing_attributes a');
    expect(query?.text).toContain('JOIN mls_fields f ON f.id = a.field_id');
    // The join key is the row's OWN listing_id — there is no second, caller-supplied argument that
    // could name a different listing than the one being queried.
    expect(query?.text).toContain('JOIN listing_search_v v ON v.id = a.listing_id');
    expect(query?.values).toEqual(['listing-1']);
  });

  it('gates on mls_fields.is_address_bearing, never re-deriving it from address_classification', async () => {
    const { client, captured } = fakeClient();

    await getListingAttributes(client, 'listing-1');

    expect(captured[0]?.text).toContain('NOT f.is_address_bearing OR v.address IS NOT NULL');
  });

  it('returns exactly what the query answers, with no app-code re-filtering', async () => {
    const rows = [{ id: 'attr-1', address_classification: 'carries_address' }];
    const { client } = fakeClient(rows);

    await expect(getListingAttributes(client, 'listing-1')).resolves.toEqual(rows);
  });
});

describe('getPropertyAttributes', () => {
  it('excludes address-bearing rows via NOT EXISTS over every visible listing on the property', async () => {
    const { client, captured } = fakeClient();

    await getPropertyAttributes(client, 'property-1');

    const [query] = captured;
    expect(query?.text).toContain('FROM property_attributes a');
    expect(query?.text).toContain('JOIN mls_fields f ON f.id = a.field_id');
    // Deliberately no single listing id: a durable, offer-independent fact cannot correctly take
    // its visibility from one caller-chosen listing among possibly several (see the doc comment).
    expect(query?.text).toContain('NOT EXISTS (');
    expect(query?.text).toContain(
      'SELECT 1 FROM listing_search_v v\n               WHERE v.property_id = a.property_id AND v.address IS NULL',
    );
    expect(query?.values).toEqual(['property-1']);
  });

  it('has no listingId parameter — only the property id is bound', async () => {
    const { client, captured } = fakeClient();

    await getPropertyAttributes(client, 'property-1');

    expect(captured[0]?.values).toHaveLength(1);
  });
});

/** #390, #501. `getNeighborhoods()` binds the query's shape. The aggregate's actual filtering runs in
 *  `tests/listings-neighborhood-groups.e2e.spec.ts` against a real Postgres. */
describe('getNeighborhoods', () => {
  const dbRow = (overrides: Record<string, unknown> = {}) => ({
    group_total: 7,
    name: 'FISHTOWN',
    city: 'Philadelphia',
    state: 'PA',
    k_name: 'fishtown',
    k_city: 'philadelphia',
    k_state: 'pa',
    total: 42,
    sale: 30,
    rent: 12,
    geo_lat: null,
    geo_lng: null,
    geo_south: null,
    geo_west: null,
    geo_north: null,
    geo_east: null,
    preview_photos: [],
    ...overrides,
  });

  describe('source', () => {
    it("reads listings directly, with the view's visibility predicate, for a scope-only request", async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text).toContain('FROM listings v');
      expect(text).not.toContain('listing_search_v');
      expect(text).toContain('v.deleted_at IS NULL');
      expect(text).toContain('v.internet_display_allowed');
      expect(text).toContain('v.consumer_status = ANY(');
      expect(text).toContain('GROUP BY lower(v.state), lower(v.neighborhood), lower(v.city)');
      expect(text).toContain('lower(v.neighborhood) <> lower(v.city)');
      expect(text).toContain("v.neighborhood !~* '^NONE\\y'");
    });

    it('reads listing_search_v through the shared filter builder when another filter is set', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, { ...baseNeighborhoodsRequest, minPrice: 300000, beds: 2 });

      const text = captured[0]?.text ?? '';
      expect(text).toContain('FROM listing_search_v v');
      expect(text).not.toContain('FROM listings v');
      expect(text).toContain('v.price >= ');
      expect(text).toContain('v.beds >= ');
      expect(captured[0]?.values).toEqual(expect.arrayContaining([300000, 2]));
    });

    it.each([
      ['neighborhood', { neighborhood: 'Fishtown' }],
      ['query', { query: 'loft' }],
      ['boolean', { waterfront: true }],
      ['amenities', { amenities: ['Waterfront'] as const }],
    ])('selects the view for the %s filter', async (_name, extra) => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, { ...baseNeighborhoodsRequest, ...extra } as never);

      expect(captured[0]?.text).toContain('FROM listing_search_v v');
    });

    it('keeps the direct source when only empty or false filters are set', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, {
        ...baseNeighborhoodsRequest,
        propertyType: [],
        openHouse: false,
      });

      expect(captured[0]?.text).toContain('FROM listings v');
    });
  });

  describe('binds', () => {
    it('binds scope, type filter, minCount, slug, limit and offset in that order', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, {
        ...baseNeighborhoodsRequest,
        state: 'MD',
        city: 'Frederick',
        minCount: 5,
        slug: 'downtown',
        limit: 10,
        offset: 20,
      });

      expect(captured[0]?.values).toEqual([
        ['sale', 'rent'],
        ['Active', 'Coming Soon'],
        'Frederick',
        'MD',
        ['sale', 'rent'],
        5,
        'downtown',
        10,
        20,
      ]);
    });

    it.each(['sale', 'rent'] as const)(
      'keeps both types in the WHERE and filters only the count for listingType=%s',
      async (listingType) => {
        const { client, captured } = fakeClient();

        await getNeighborhoods(client, { ...baseNeighborhoodsRequest, listingType });

        const values = captured[0]?.values ?? [];
        expect(values[0]).toEqual(['sale', 'rent']);
        expect(values).toContainEqual([listingType]);
      },
    );

    it('binds the place pairs as two arrays', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, {
        ...baseNeighborhoodsRequest,
        place: [
          { city: 'Bethesda', state: 'MD' },
          { city: 'Arlington', state: 'VA' },
        ],
      });

      expect(captured[0]?.text).toContain('unnest(');
      expect(captured[0]?.values).toEqual(
        expect.arrayContaining([
          ['MD', 'VA'],
          ['Bethesda', 'Arlington'],
        ]),
      );
    });
  });

  describe('order and paging', () => {
    it('orders by count, then name, then key', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      expect(captured[0]?.text).toContain(
        'row_number() OVER (ORDER BY total DESC, k_name ASC, k_state ASC, k_city ASC)',
      );
    });

    it('orders by name, then key', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, { ...baseNeighborhoodsRequest, order: 'name' });

      expect(captured[0]?.text).toContain(
        'row_number() OVER (ORDER BY k_name ASC, k_state ASC, k_city ASC)',
      );
    });

    it('computes the exact total outside the page, so an offset past the end keeps it', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text).toContain('totals AS (SELECT count(*)::int AS group_total FROM matching)');
      expect(text.indexOf('totals AS')).toBeLessThan(text.indexOf('OFFSET'));
    });

    it('answers an offset past the end with no rows and the exact total', async () => {
      const { client } = fakeClient([dbRow({ name: null, total: null })]);

      const result = await getNeighborhoods(client, { ...baseNeighborhoodsRequest, offset: 500 });

      expect(result).toEqual({ results: [], total: 7 });
    });

    it('answers an empty result set with total 0', async () => {
      const { client } = fakeClient([]);

      expect(await getNeighborhoods(client, baseNeighborhoodsRequest)).toEqual({
        results: [],
        total: 0,
      });
    });
  });

  describe('row mapping', () => {
    it('title-cases name, derives slug and key, and echoes the exact group total', async () => {
      const { client } = fakeClient([dbRow()]);

      const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

      expect(result).toEqual({
        results: [
          {
            key: 'pa|philadelphia|fishtown',
            name: 'Fishtown',
            city: 'Philadelphia',
            state: 'PA',
            slug: 'fishtown',
            total: 42,
            sale: 30,
            rent: 12,
            centroid: null,
            bounds: null,
          },
        ],
        total: 7,
      });
    });

    it('gives two cities with the same neighborhood name different keys', async () => {
      const { client } = fakeClient([
        dbRow({ name: 'Downtown', city: 'Bethesda', k_name: 'downtown', k_city: 'bethesda' }),
        dbRow({ name: 'Downtown', city: 'Rockville', k_name: 'downtown', k_city: 'rockville' }),
      ]);

      const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

      const keys = result.results.map((r) => r.key);
      expect(new Set(keys).size).toBe(2);
      expect(result.results.map((r) => r.slug)).toEqual(['downtown', 'downtown']);
    });

    it('maps centroid and bounds, and leaves both null when no listing allows its address', async () => {
      const { client } = fakeClient([
        dbRow({
          geo_lat: 39.97,
          geo_lng: -75.13,
          geo_south: 39.96,
          geo_west: -75.14,
          geo_north: 39.98,
          geo_east: -75.12,
        }),
        dbRow({ name: 'KENSINGTON', k_name: 'kensington' }),
      ]);

      const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

      expect(result.results[0]?.centroid).toEqual({ lat: 39.97, lng: -75.13 });
      expect(result.results[0]?.bounds).toEqual({
        south: 39.96,
        west: -75.14,
        north: 39.98,
        east: -75.12,
      });
      expect(result.results[1]?.centroid).toBeNull();
      expect(result.results[1]?.bounds).toBeNull();
    });
  });

  describe('masked addresses (#501)', () => {
    it('reads the median of coordinates with address display allowed only, on the direct path', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      const geo = text.slice(text.indexOf('WITH pts AS'));
      expect(geo).toContain('percentile_cont(0.5) WITHIN GROUP (ORDER BY ln)');
      expect(geo.slice(0, geo.indexOf('med AS'))).toContain('v.address_display_allowed AND');
    });

    it('excludes null, zero and out-of-range coordinates, and bounds only points near the median (#512)', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text).toContain('v.latitude <> 0 AND v.longitude <> 0');
      expect(text).toContain('abs(v.latitude) <= 90 AND abs(v.longitude) <= 180');
      expect(text).toContain('abs(pts.la - med.lat) <= 0.25');
      expect(text).toContain('abs(pts.ln - med.lng) <= 0.25');
      expect(text).not.toMatch(/min(v.latitude)|max(v.latitude)/);
    });

    it('reads only the view masked coordinates on the view path, never the unmasked flag column', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, { ...baseNeighborhoodsRequest, beds: 2 });

      const text = captured[0]?.text ?? '';
      expect(text).toContain('v.latitude <> 0 AND v.longitude <> 0');
      expect(text).not.toContain('address_display_allowed');
    });

    it('reads centroid and bounds only for the groups of the page', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text.indexOf('LIMIT $')).toBeLessThan(text.indexOf('percentile_cont'));
      expect(text).toContain('lower(v.neighborhood) = page.k_name');
    });
  });

  describe('previewPhotos (#486)', () => {
    const photos = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        url: `https://cdn.example/${i}.jpg`,
        listingId: `listing-${i}`,
      }));

    it.each([0, 1, 3, 5])('maps %i qualifying photos', async (count) => {
      const { client } = fakeClient([dbRow({ preview_photos: photos(count) })]);

      const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

      if (count === 0) {
        expect(result.results[0]?.previewPhotos).toBeUndefined();
      } else {
        expect(result.results[0]?.previewPhotos).toEqual(photos(count));
      }
    });

    it('never passes more than 5 photos: the contract rejects a sixth', async () => {
      const { client } = fakeClient([dbRow({ preview_photos: photos(6) })]);

      await expect(getNeighborhoods(client, baseNeighborhoodsRequest)).rejects.toThrow();
    });

    it('applies the photo lookup after the page LIMIT, to the requested listing type', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text.indexOf('LIMIT $')).toBeLessThan(text.indexOf("jsonb_build_object('url'"));
      expect(text).toContain('LIMIT 5');
    });

    it('gates photos on the same media rules as search, over the same filters', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text).toContain('(v.media_display_allowed OR m.retained_when_suppressed)');
      expect(text).toContain('ORDER BY m.is_primary DESC, m.sort_order, m.id');
      expect(text).toContain('ORDER BY v.listed_at DESC NULLS LAST, v.id DESC');
    });
  });
});

describe('listBrightListingIdentities', () => {
  it('reads listings directly, not listing_search_v, and excludes soft-deleted rows', async () => {
    const { client, captured } = fakeClient();

    await listBrightListingIdentities(client, {
      city: 'Frederick',
      state: 'MD',
      statusCodes: ['Active', 'Pending'],
    });

    const [query] = captured;
    expect(query?.text).toContain('FROM listings');
    expect(query?.text).not.toContain('listing_search_v');
    expect(query?.text).toContain("source_system = 'BrightMLS'");
    expect(query?.text).toContain('deleted_at IS NULL');
    expect(query?.values).toEqual([['Active', 'Pending'], 'Frederick', 'MD', null]);
  });

  it('returns no rows and issues no query for an empty status list', async () => {
    const { client, captured } = fakeClient();

    const result = await listBrightListingIdentities(client, { statusCodes: [] });

    expect(result).toEqual([]);
    expect(captured).toEqual([]);
  });

  it('maps rows to the id/sourceListingKey shape the reconciliation diff needs', async () => {
    const { client } = fakeClient([{ id: 'l1', source_listing_key: '111' }]);

    const result = await listBrightListingIdentities(client, { statusCodes: ['Active'] });

    expect(result).toEqual([{ id: 'l1', sourceListingKey: '111' }]);
  });
});
