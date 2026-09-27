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
  it('reads listing_search_v, groups by lower(neighborhood)/lower(city)/state, and excludes name == city', async () => {
    const { client, captured } = fakeClient();

    await getNeighborhoods(client, baseNeighborhoodsRequest);

    const [query] = captured;
    expect(query?.text).toContain('FROM listing_search_v v');
    expect(query?.text).toContain('GROUP BY lower(v.neighborhood), lower(v.city), v.state');
    expect(query?.text).toContain('lower(v.neighborhood) <> lower(v.city)');
  });

  it('applies the shared noise gate defensively, not a second copy of the rule', async () => {
    const { client, captured } = fakeClient();

    await getNeighborhoods(client, baseNeighborhoodsRequest);

    expect(captured[0]?.text).toContain("v.neighborhood !~* '^NONE'");
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
