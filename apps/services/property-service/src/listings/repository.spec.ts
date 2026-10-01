import type { NeighborhoodsRequest } from '@cribstop/property-contracts';
import {
  getListingAttributes,
  getNeighborhoods,
  getPropertyAttributes,
  listBrightListingIdentities,
  type ReadClient,
} from './repository';

const baseNeighborhoodsRequest: NeighborhoodsRequest = {
  listingType: 'all',
  minCount: 3,
  limit: 24,
};

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

/** #390. `getNeighborhoods()` binds the query's shape; the aggregate's actual filtering needs a
 *  real Postgres and is out of this project's DB-free unit-test scope (matching every other test
 *  in this file). */
describe('getNeighborhoods', () => {
  it("reads listings directly (not listing_search_v) with the view's own visibility predicate, grouped and excluding name == city", async () => {
    const { client, captured } = fakeClient();

    await getNeighborhoods(client, baseNeighborhoodsRequest);

    const [query] = captured;
    expect(query?.text).toContain('FROM listings l');
    expect(query?.text).not.toContain('listing_search_v');
    expect(query?.text).toContain('l.deleted_at IS NULL');
    expect(query?.text).toContain('l.internet_display_allowed');
    expect(query?.text).toContain('GROUP BY lower(l.state), lower(l.neighborhood), lower(l.city)');
    expect(query?.text).toContain('lower(l.neighborhood) <> lower(l.city)');
  });

  it('applies the shared noise gate defensively, not a second copy of the rule', async () => {
    const { client, captured } = fakeClient();

    await getNeighborhoods(client, baseNeighborhoodsRequest);

    expect(captured[0]?.text).toContain("l.neighborhood !~* '^NONE\\y'");
  });

  it('binds listingType, state, city, minCount, slug and limit in that order', async () => {
    const { client, captured } = fakeClient();

    await getNeighborhoods(client, {
      ...baseNeighborhoodsRequest,
      listingType: 'sale',
      state: 'MD',
      city: 'Frederick',
      minCount: 5,
      slug: 'downtown',
      limit: 10,
    });

    expect(captured[0]?.values).toEqual(['sale', 'MD', 'Frederick', 5, 'downtown', 10]);
  });

  it('title-cases name, derives slug, and echoes the window count as the envelope total', async () => {
    const rows = [
      {
        name: 'FISHTOWN',
        city: 'Philadelphia',
        state: 'PA',
        total: 42,
        sale: 30,
        rent: 12,
        group_total: 7,
        preview_photos: [],
      },
    ];
    const { client } = fakeClient(rows);

    const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

    expect(result).toEqual({
      results: [
        {
          name: 'Fishtown',
          city: 'Philadelphia',
          state: 'PA',
          slug: 'fishtown',
          total: 42,
          sale: 30,
          rent: 12,
        },
      ],
      total: 7,
    });
  });

  it('answers an empty result set with total 0', async () => {
    const { client } = fakeClient([]);

    const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

    expect(result).toEqual({ results: [], total: 0 });
  });

  describe('previewPhotos (#486)', () => {
    const row = (previewPhotos: { url: string; listingId: string }[]) => ({
      name: 'FISHTOWN',
      city: 'Philadelphia',
      state: 'PA',
      total: 6,
      sale: 6,
      rent: 0,
      group_total: 1,
      preview_photos: previewPhotos,
    });
    const photos = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        url: `https://cdn.example/${i}.jpg`,
        listingId: `listing-${i}`,
      }));

    it.each([0, 1, 3, 5])('maps %i qualifying photos', async (count) => {
      const { client } = fakeClient([row(photos(count))]);

      const result = await getNeighborhoods(client, baseNeighborhoodsRequest);

      if (count === 0) {
        expect(result.results[0]?.previewPhotos).toBeUndefined();
      } else {
        expect(result.results[0]?.previewPhotos).toEqual(photos(count));
      }
    });

    it('never passes more than 5 photos: the contract rejects a sixth', async () => {
      const { client } = fakeClient([row(photos(6))]);

      await expect(getNeighborhoods(client, baseNeighborhoodsRequest)).rejects.toThrow();
    });

    it('applies the photo lookup after the page LIMIT, to the listing types the row counts', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text.indexOf('LIMIT $6')).toBeGreaterThan(-1);
      expect(text.indexOf('LIMIT $6')).toBeLessThan(text.indexOf('LEFT JOIN LATERAL'));
      expect(text).toContain("($1::text = 'all' OR pl.listing_type = $1)");
      expect(text).not.toContain("pl.listing_type = 'sale'");
      expect(text).toContain('LIMIT 5');
    });

    it('gates photos on the same visibility and media rules as search', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      const text = captured[0]?.text ?? '';
      expect(text).toContain('pl.deleted_at IS NULL');
      expect(text).toContain('pl.internet_display_allowed');
      expect(text).toContain("(pl.consumer_status <> 'Sold' OR pl.close_date IS NOT NULL)");
      expect(text).toContain('(pl.media_display_allowed OR m.retained_when_suppressed)');
      expect(text).toContain('ORDER BY m.is_primary DESC, m.sort_order, m.id');
    });

    it('orders photos newest listed first, listing id as the tie-break', async () => {
      const { client, captured } = fakeClient();

      await getNeighborhoods(client, baseNeighborhoodsRequest);

      expect(captured[0]?.text).toContain('ORDER BY pl.listed_at DESC NULLS LAST, pl.id DESC');
    });

    it.each(['all', 'sale', 'rent'] as const)(
      'binds listingType=%s as the photo type filter',
      async (listingType) => {
        const { client, captured } = fakeClient();

        await getNeighborhoods(client, { ...baseNeighborhoodsRequest, listingType });

        expect(captured[0]?.text).toContain("($1::text = 'all' OR pl.listing_type = $1)");
        expect(captured[0]?.values[0]).toBe(listingType);
      },
    );
  });
});

/** The daily key reconciliation's local read (#331). */
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
