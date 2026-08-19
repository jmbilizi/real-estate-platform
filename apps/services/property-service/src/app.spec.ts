import request from 'supertest';
import { ATTRIBUTION_KEYS, NOT_FOUND_BODY } from '@cribstop/property-contracts';
import { createApp } from './app';
import type { ReadPool } from './listings/repository';
import { cardDbRowFixture } from './listings/test-fixtures';

/**
 * The HTTP surface, exercised end to end through Express against a FAKE pool — no socket, no database.
 *
 * The fake records every statement it is handed, which is what lets these tests assert the two
 * properties no downstream test can recover: that every read goes through `listing_search_v`, and that
 * no statement uses a wildcard projection. Both are compliance invariants (the view enforces the
 * display rules; a wildcard reads whatever the view happens to project, including its compliance
 * predicate inputs and anything a future migration adds), not style preferences.
 */
interface FakePool extends ReadPool {
  statements: string[];
}

function createFakePool(rowsFor: (sql: string) => unknown[]): FakePool {
  const statements: string[] = [];
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    statements.push(text);
    return Promise.resolve({ rows: rowsFor(text) as T[] });
  };
  return {
    statements,
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
}

/** A pool that answers the count, the page and the meta aggregate with plausible data. */
function createSearchPool(rows: unknown[] = [cardDbRowFixture()], total = 1): FakePool {
  return createFakePool((sql) => {
    if (sql.includes('count(*)::int AS total')) {
      return [{ total }];
    }
    if (sql.includes('data_updated_at')) {
      return [
        {
          data_updated_at: new Date('2026-04-18T10:30:00.000Z'),
          sources: ['internal'],
          listing_count: total,
        },
      ];
    }
    return rows;
  });
}

const KNOWN_ID = cardDbRowFixture().id;

describe('GET /health', () => {
  it('responds 200 with a status ok payload', async () => {
    const response = await request(createApp({ pool: createSearchPool() })).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('read-model invariants, asserted against the SQL actually issued', () => {
  it('reads every endpoint through listing_search_v', async () => {
    const pool = createSearchPool();
    const app = createApp({ pool });

    await request(app).get('/listings');
    await request(app).get('/listings/meta');
    await request(app).get(`/listings/${KNOWN_ID}`);

    const reads = pool.statements.filter((sql) => sql.includes('SELECT'));
    expect(reads.length).toBeGreaterThan(0);
    for (const sql of reads) {
      expect(sql).toContain('listing_search_v');
    }
  });

  it('never issues a wildcard projection, and never names street_line (#48)', async () => {
    const pool = createSearchPool();
    const app = createApp({ pool });

    await request(app).get('/listings');
    await request(app).get(`/listings/${KNOWN_ID}`);

    for (const sql of pool.statements) {
      expect(sql).not.toMatch(/SELECT\s+\*/);
      expect(sql).not.toContain('street_line');
    }
  });

  it('runs the count and the page in one repeatable-read read-only transaction', async () => {
    // `now()` is transaction-scoped, so the view's `ends_at > now()` open-house bound must be
    // identical for both statements, or `total` describes a different result set than the page does.
    const pool = createSearchPool();

    await request(createApp({ pool })).get('/listings');

    expect(pool.statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(pool.statements).toContain('COMMIT');
  });
});

describe('GET /listings', () => {
  it('returns the envelope with an exact total and a derived pageCount', async () => {
    const response = await request(createApp({ pool: createSearchPool([cardDbRowFixture()], 45) }))
      .get('/listings')
      .expect(200);

    expect(response.body.total).toBe(45);
    expect(response.body.page).toBe(1);
    expect(response.body.pageSize).toBe(20);
    expect(response.body.pageCount).toBe(3);
  });

  it('echoes the normalised applied filter set, defaults included', async () => {
    const response = await request(createApp({ pool: createSearchPool() }))
      .get('/listings?beds=3')
      .expect(200);

    expect(response.body.appliedFilters).toMatchObject({
      beds: 3,
      listingType: 'all',
      propertyType: 'all',
      sort: 'recommended',
      page: 1,
      pageSize: 20,
    });
  });

  it('returns an empty page with the correct total past the end, never a 404', async () => {
    const response = await request(createApp({ pool: createSearchPool([], 45) }))
      .get('/listings?page=99')
      .expect(200);

    expect(response.body.results).toEqual([]);
    expect(response.body.total).toBe(45);
  });

  it('carries the complete attribution block on every row', async () => {
    const response = await request(
      createApp({ pool: createSearchPool([cardDbRowFixture(), cardDbRowFixture()], 2) }),
    )
      .get('/listings')
      .expect(200);

    expect(response.body.results).toHaveLength(2);
    for (const row of response.body.results) {
      for (const key of ATTRIBUTION_KEYS) {
        expect(row).toHaveProperty(key);
      }
    }
  });

  it('never puts description on a list row', async () => {
    const response = await request(createApp({ pool: createSearchPool() }))
      .get('/listings')
      .expect(200);

    expect(response.body.results[0]).not.toHaveProperty('description');
  });

  it('derives sponsored from featured_reason = paid, not from featured', async () => {
    const plain = await request(
      createApp({ pool: createSearchPool([cardDbRowFixture({ featured: true })]) }),
    ).get('/listings');
    expect(plain.body.results[0].sponsored).toBe(false);

    const paid = await request(
      createApp({
        pool: createSearchPool([cardDbRowFixture({ featured: true, featured_reason: 'paid' })]),
      }),
    ).get('/listings');
    expect(paid.body.results[0].sponsored).toBe(true);
  });

  it('collapses the view’s three open-house columns into one nullable occurrence', async () => {
    const response = await request(
      createApp({
        pool: createSearchPool([
          cardDbRowFixture({
            open_house_starts_at: new Date('2026-08-15T14:00:00.000Z'),
            open_house_ends_at: new Date('2026-08-15T16:00:00.000Z'),
            open_house_remarks: 'Street parking available.',
          }),
        ]),
      }),
    )
      .get('/listings')
      .expect(200);

    expect(response.body.results[0].openHouse).toEqual({
      startsAt: '2026-08-15T14:00:00.000Z',
      endsAt: '2026-08-15T16:00:00.000Z',
      remarks: 'Street parking available.',
    });
    // There is deliberately no boolean; the occurrence's presence IS the badge condition.
    expect(response.body.results[0]).not.toHaveProperty('hasOpenHouse');
  });

  it('emits closeDate as a calendar day, not a shifted instant', async () => {
    const response = await request(
      createApp({
        pool: createSearchPool([
          cardDbRowFixture({
            listing_type: 'sold',
            status: 'Sold',
            close_price: 480000,
            close_date: '2026-01-05',
          }),
        ]),
      }),
    )
      .get('/listings?listingType=sold')
      .expect(200);

    expect(response.body.results[0].closeDate).toBe('2026-01-05');
    // The ask and the sale price are both present: rendering the ask as the sale price would
    // misrepresent the transaction.
    expect(response.body.results[0].closePrice).toBe(480000);
    expect(response.body.results[0].price).toBe(500000);
  });

  it('sets a cache TTL of at most 60s, and never no-store', async () => {
    const response = await request(createApp({ pool: createSearchPool() })).get('/listings');

    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.headers['cache-control']).not.toContain('no-store');
  });

  it('never emits per-user state, which would make every search response uncacheable', async () => {
    const response = await request(createApp({ pool: createSearchPool() })).get('/listings');

    expect(response.body.results[0]).not.toHaveProperty('isSaved');
    expect(response.body.results[0]).not.toHaveProperty('isFavorited');
  });

  describe('strict parsing', () => {
    it.each([
      ['an unknown parameter', '/listings?bed=3'],
      ['a field-selection attempt', '/listings?fields=id'],
      ['a sparse-fieldset attempt', '/listings?select=id,title'],
      ['a pageSize above the documented maximum', '/listings?pageSize=101'],
      ['a non-numeric beds', '/listings?beds=three'],
      ['an unknown sort', '/listings?sort=nearest'],
      ['an amenity outside the closed set', '/listings?amenities=Helipad'],
      ['a page of zero', '/listings?page=0'],
    ])('rejects %s with 400', async (_label, path) => {
      const response = await request(createApp({ pool: createSearchPool() })).get(path);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_request');
    });

    it('does not echo the caller-supplied value back in the error message', async () => {
      const response = await request(createApp({ pool: createSearchPool() })).get(
        '/listings?bed=%3Cscript%3E',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).not.toContain('<script>');
    });

    it('names the offending parameter, so a typo is debuggable', async () => {
      // A strict-object rejection is reported as `unrecognized_keys`, whose `path` is EMPTY and whose
      // names live in `issue.keys`. Reading only `path` reported every unknown parameter as
      // "(request)" — technically a 400, but it told the caller nothing about which parameter was
      // wrong, which defeats half the reason for rejecting typos in the first place.
      const response = await request(createApp({ pool: createSearchPool() })).get(
        '/listings?bed=3',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('bed');
      expect(response.body.error.message).not.toContain('(request)');
    });

    it('does not call a known parameter with a bad value an unknown parameter', async () => {
      // `pageSize` IS a published parameter; 101 is simply above the documented maximum of 100.
      // Reporting it as an unknown/field-selection parameter sends whoever is debugging it looking
      // for a typo or a stripped-attribution attempt instead of at the value they sent, which is the
      // one thing the message exists to tell them. Both cases stay 400 — only the wording differs.
      const response = await request(createApp({ pool: createSearchPool() })).get(
        '/listings?pageSize=101',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('pageSize');
      expect(response.body.error.message).not.toMatch(/unknown/i);
      expect(response.body.error.message).not.toMatch(/field-selection/i);
    });

    it('still calls an unrecognised parameter unknown, and says there is no field selection', async () => {
      const response = await request(createApp({ pool: createSearchPool() })).get(
        '/listings?fields=id',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/unknown/i);
      expect(response.body.error.message).toContain('fields');
      expect(response.body.error.message).toMatch(/field-selection/i);
    });

    it('reports both classes separately when a request carries each', async () => {
      const response = await request(createApp({ pool: createSearchPool() })).get(
        '/listings?bed=3&pageSize=101',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('bed');
      expect(response.body.error.message).toContain('pageSize');
    });

    it('does not reflect a hostile parameter NAME either', async () => {
      // The key is caller-controlled too, so naming it must not turn the body into a reflection
      // surface. Filtered to an identifier shape and truncated, not echoed.
      const response = await request(createApp({ pool: createSearchPool() })).get(
        '/listings?%3Cimg%20src%3Dx%3E=1',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.message).not.toContain('<img');
      expect(response.body.error.message).toContain('(unnamed)');
    });
  });
});

describe('GET /listings/meta', () => {
  it('is reachable without running a search and carries the longer shared-cache TTL', async () => {
    const response = await request(createApp({ pool: createSearchPool([], 12) }))
      .get('/listings/meta')
      .expect(200);

    expect(response.body).toEqual({
      dataUpdatedAt: '2026-04-18T10:30:00.000Z',
      sources: ['internal'],
      listingCount: 12,
    });
    expect(response.headers['cache-control']).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
    );
  });

  it('is not captured by the /listings/:id route', async () => {
    // Registration order plus the id-shape check both protect this. If either broke, the footer —
    // which renders on every route in the app — would 404 everywhere.
    const pool = createSearchPool([], 0);

    const response = await request(createApp({ pool })).get('/listings/meta');

    expect(response.status).toBe(200);
    expect(pool.statements.some((sql) => sql.includes('data_updated_at'))).toBe(true);
  });

  it('returns null freshness rather than a fabricated timestamp when nothing is publishable', async () => {
    const pool = createFakePool(() => [{ data_updated_at: null, sources: null, listing_count: 0 }]);

    const response = await request(createApp({ pool })).get('/listings/meta').expect(200);

    expect(response.body).toEqual({ dataUpdatedAt: null, sources: [], listingCount: 0 });
  });

  it('derives freshness from the view, so a suppressed listing cannot advance it', async () => {
    const pool = createSearchPool([], 1);

    await request(createApp({ pool })).get('/listings/meta');

    const aggregate = pool.statements.find((sql) => sql.includes('data_updated_at'));
    expect(aggregate).toContain('listing_search_v');
    expect(aggregate).toContain('max(v.last_updated)');
    // `updated_at` moves on any local write; `last_updated` is MLS feed freshness. Surfacing the
    // wrong one would make the footer claim a refresh that never happened.
    expect(aggregate).not.toContain('updated_at)');
  });
});

describe('GET /listings/:id', () => {
  it('returns the nested property/unit/listing graph with description', async () => {
    const pool = createFakePool(() => [
      cardDbRowFixture({ description: 'Three bedrooms and a detached garage.' }),
    ]);

    const response = await request(createApp({ pool })).get(`/listings/${KNOWN_ID}`).expect(200);

    expect(response.body.property).toBeDefined();
    expect(response.body.listing.description).toBe('Three bedrooms and a detached garage.');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('returns unit: null for a non-subdivided home rather than synthesising a unit', async () => {
    const pool = createFakePool(() => [cardDbRowFixture({ unit_id: null })]);

    const response = await request(createApp({ pool })).get(`/listings/${KNOWN_ID}`).expect(200);

    expect(response.body.unit).toBeNull();
  });

  it('suppresses unit.unitNumber whenever the view masked the address', async () => {
    const pool = createFakePool(() => [
      cardDbRowFixture({
        address: null,
        latitude: null,
        longitude: null,
        unit_id: '0195f2d0-1111-7000-8000-000000000abc',
        unit_number: '4B',
      }),
    ]);

    const response = await request(createApp({ pool })).get(`/listings/${KNOWN_ID}`).expect(200);

    expect(response.body.listing.address).toBeNull();
    expect(response.body.unit.unitNumber).toBeNull();
  });

  describe('404 parity — the seller opt-out depends on these being indistinguishable', () => {
    const bodies: unknown[] = [];

    it.each([
      ['an unknown or soft-deleted id', '/listings/0195f2d0-2222-7000-8000-00000000dead'],
      ['a listing the view excludes', '/listings/0195f2d0-3333-7000-8000-00000000beef'],
      ['a malformed id', '/listings/not-a-uuid'],
      ['an id-shaped path segment that is not an id', '/listings/12345'],
    ])('returns the identical 404 for %s', async (_label, path) => {
      // The empty-rows pool is exactly what makes the first two indistinguishable at this layer: the
      // repository returns null for "no row", and the view excluding a row IS "no row".
      const response = await request(createApp({ pool: createFakePool(() => []) })).get(path);

      expect(response.status).toBe(404);
      expect(response.body).toEqual(NOT_FOUND_BODY);
      bodies.push(response.body);
    });

    it('serialises byte-identically in every case', () => {
      expect(bodies).toHaveLength(4);
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    });

    it('never answers 403, which would confirm the listing exists', async () => {
      const response = await request(createApp({ pool: createFakePool(() => []) })).get(
        '/listings/0195f2d0-4444-7000-8000-0000000000ff',
      );

      expect(response.status).not.toBe(403);
    });
  });
});

describe('GET /openapi.json', () => {
  it('serves the generated Property API document for gateway aggregation', async () => {
    const response = await request(createApp({ pool: createSearchPool() }))
      .get('/openapi.json')
      .expect(200);

    expect(response.body.info.title).toBe('Property Service');
    expect(Object.keys(response.body.paths).sort()).toEqual([
      '/listings',
      '/listings/meta',
      '/listings/{id}',
    ]);
  });

  it('publishes no field-selection parameter, so attribution cannot be stripped', async () => {
    const response = await request(createApp({ pool: createSearchPool() })).get('/openapi.json');

    const names = response.body.paths['/listings'].get.parameters.map(
      (parameter: { name: string }) => parameter.name,
    );
    for (const forbidden of ['fields', 'select', 'include', 'omit', 'exclude']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('error boundary', () => {
  it('turns a database failure into an opaque 500 rather than a hanging request', async () => {
    const failing = (): Promise<{ rows: never[] }> =>
      Promise.reject(new Error('relation "listings" does not exist'));
    const pool: ReadPool = {
      query: failing,
      connect: () => Promise.resolve({ query: failing, release: () => undefined }),
    };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await request(createApp({ pool })).get('/listings/meta');

    expect(response.status).toBe(500);
    // A pg error names tables, columns and constraint text. These endpoints are public and
    // unauthenticated, so that detail belongs in the log and not in the body.
    expect(JSON.stringify(response.body)).not.toContain('relation');
    consoleError.mockRestore();
  });
});
