import request from 'supertest';
import {
  ATTRIBUTION_KEYS,
  MAX_RESULT_OFFSET,
  maxReachablePage,
  NOT_FOUND_BODY,
  PAGE_SIZE_DEFAULT,
  SORT_VALUES,
} from '@cribstop/property-contracts';
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

  // `page=51` is the deepest page INSIDE the result window at the default page size (#65) and is
  // far past the end of a 45-row result set — which is the case this test has always been about.
  // It deliberately does not use a page past the window (it used to say `page=99`): that would now
  // 400 on the window rule and stop exercising the past-the-end rule at all. The two rules are
  // independent and this test must keep testing the one it names.
  it('returns an empty page with the correct total past the end, never a 404', async () => {
    const response = await request(createApp({ pool: createSearchPool([], 45) }))
      .get(`/listings?page=${maxReachablePage(PAGE_SIZE_DEFAULT)}`)
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

  /**
   * The result window (#65). These run against the fake pool, so they assert the rule itself —
   * which requests reach the database at all — independently of any dataset.
   */
  describe('result window', () => {
    const lastPage = maxReachablePage(PAGE_SIZE_DEFAULT);

    it('serves the deepest page inside the window as a normal 200', async () => {
      const response = await request(createApp({ pool: createSearchPool([], 5000) })).get(
        `/listings?page=${lastPage}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.page).toBe(lastPage);
    });

    it('rejects the first page past the window with 400 and a code that names the limit', async () => {
      const response = await request(createApp({ pool: createSearchPool([], 5000) })).get(
        `/listings?page=${lastPage + 1}`,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('result_window_exceeded');
      expect(response.body.error.message).toContain(String(MAX_RESULT_OFFSET));
    });

    it('does not report it as invalid_request — the parameters are well-formed, the depth is not available', async () => {
      const response = await request(createApp({ pool: createSearchPool([], 5000) })).get(
        `/listings?page=${lastPage + 1}`,
      );

      expect(response.body.error.code).not.toBe('invalid_request');
      expect(response.body.error.message).not.toMatch(/unknown/i);
    });

    it('never clamps to the last valid page and never answers with an empty 200', async () => {
      // Silently clamping (or returning an empty page) teaches an integrator that paging works
      // when it does not, which is the exact failure the 400 exists to prevent.
      const response = await request(createApp({ pool: createSearchPool([], 5000) })).get(
        '/listings?page=9999',
      );

      expect(response.status).toBe(400);
      expect(response.body).not.toHaveProperty('results');
      expect(response.body).not.toHaveProperty('page');
    });

    it('runs no SQL at all for a rejected request — the exact COUNT(*) is the expensive half', async () => {
      const pool = createSearchPool([], 5000);

      await request(createApp({ pool })).get('/listings?page=9999');

      expect(pool.statements).toEqual([]);
    });

    it('bounds the offset, not the page number, so the bound moves with page size', async () => {
      // `pageSize=100, page=11` is offset 1000 — in window. `page=12` is offset 1100 — out. The
      // deepest row a larger page size reaches is one page further in (1,100 vs 1,020), which is
      // what bounding the OFFSET means; what it cannot do is scale with the dataset.
      const app = createApp({ pool: createSearchPool([], 5000) });

      expect((await request(app).get('/listings?pageSize=100&page=11')).status).toBe(200);
      expect((await request(app).get('/listings?pageSize=100&page=12')).status).toBe(400);
    });

    it('applies identically across every sort', async () => {
      const app = createApp({ pool: createSearchPool([], 5000) });

      for (const sort of SORT_VALUES) {
        expect((await request(app).get(`/listings?sort=${sort}&page=${lastPage}`)).status).toBe(
          200,
        );
        const rejected = await request(app).get(`/listings?sort=${sort}&page=${lastPage + 1}`);
        expect(rejected.status).toBe(400);
        expect(rejected.body.error.code).toBe('result_window_exceeded');
      }
    });

    it('applies identically across filter combinations, including listingType=sold', async () => {
      const app = createApp({ pool: createSearchPool([], 5000) });
      const filters = [
        '',
        'listingType=sold',
        'listingType=rent&beds=2',
        'query=Fixture',
        'openHouse=true',
        'amenities=Pool,Garage&propertyType=Condo',
      ];

      for (const filter of filters) {
        const suffix = filter ? `${filter}&` : '';
        expect((await request(app).get(`/listings?${suffix}page=${lastPage}`)).status).toBe(200);
        expect((await request(app).get(`/listings?${suffix}page=${lastPage + 1}`)).status).toBe(
          400,
        );
      }
    });

    it('leaves total untouched on the deepest in-window page — it is the full filtered count, never the window', async () => {
      const response = await request(createApp({ pool: createSearchPool([], 5000) })).get(
        `/listings?page=${lastPage}`,
      );

      expect(response.body.total).toBe(5000);
      expect(response.body.total).toBeGreaterThan(MAX_RESULT_OFFSET);
      expect(response.body.pageCount).toBe(250);
    });

    it('adds no parameter that lifts the bound', async () => {
      // Strict parsing already forecloses this, but the assertion belongs with the window: an
      // escape hatch added later would be the one change that quietly undoes all of the above.
      for (const escape of ['offset=2000', 'limit=5000', 'all=true', 'export=1', 'cursor=x']) {
        const response = await request(createApp({ pool: createSearchPool() })).get(
          `/listings?${escape}`,
        );
        expect(response.status).toBe(400);
      }
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

describe('POST /listings/:id/inquiries (#131)', () => {
  const ALWAYS_ALLOW = { consume: () => ({ allowed: true, retryAfterSeconds: 0 }) };
  const ALWAYS_SIGNED_OUT = { resolveAccountId: () => Promise.resolve(null) };
  const VALID_BODY = {
    kind: 'tour_request' as const,
    name: 'Jane Consumer',
    email: 'jane@example.com',
  };

  /** A fake pool answering both the existence-check EXISTS query and the INSERT. */
  function createInquiryPool(
    options: { publishable?: boolean; insertedId?: string } = {},
  ): FakePool {
    const publishable = options.publishable ?? true;
    const insertedId = options.insertedId ?? '018f2f2a-6d1b-7c3d-8b2e-0000000000cc';
    return createFakePool((sql) => {
      if (sql.includes('EXISTS(')) {
        return [{ exists: publishable }];
      }
      if (sql.includes('INSERT INTO listing_inquiries')) {
        return [{ id: insertedId }];
      }
      return [];
    });
  }

  it('creates an inquiry and returns 201 with the created id', async () => {
    const pool = createInquiryPool({ insertedId: '018f2f2a-6d1b-7c3d-8b2e-0000000000cc' });
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app).post(`/listings/${KNOWN_ID}/inquiries`).send(VALID_BODY);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: '018f2f2a-6d1b-7c3d-8b2e-0000000000cc' });
  });

  it('works signed-out: an unauthenticated request is never rejected for being unauthenticated', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app).post(`/listings/${KNOWN_ID}/inquiries`).send(VALID_BODY);

    expect(response.status).toBe(201);
  });

  it('works signed-in: resolves an account id and still records the submitted contact details', async () => {
    const pool = createInquiryPool();
    const app = createApp({
      pool,
      introspection: { resolveAccountId: () => Promise.resolve('018f2f2a-account-0000000000dd') },
      rateLimiter: ALWAYS_ALLOW,
    });

    const response = await request(app)
      .post(`/listings/${KNOWN_ID}/inquiries`)
      .set('Cookie', '.AspNetCore.Identity.Application=abc')
      .send(VALID_BODY);

    expect(response.status).toBe(201);
    const insert = pool.statements.find((sql) => sql.includes('INSERT INTO listing_inquiries'));
    expect(insert).toBeDefined();
  });

  it('rejects an unknown listing with the identical NOT_FOUND_BODY', async () => {
    const pool = createInquiryPool({ publishable: false });
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app).post(`/listings/${KNOWN_ID}/inquiries`).send(VALID_BODY);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('rejects a malformed id with 404, matching the detail endpoint', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app).post('/listings/not-a-uuid/inquiries').send(VALID_BODY);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('rejects an unknown field, the Fair Housing guardrail (#34)', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app)
      .post(`/listings/${KNOWN_ID}/inquiries`)
      .send({ ...VALID_BODY, occupancy: 3 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('rejects a "message" kind with no message', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app)
      .post(`/listings/${KNOWN_ID}/inquiries`)
      .send({ ...VALID_BODY, kind: 'message' });

    expect(response.status).toBe(400);
  });

  it('returns 429 with Retry-After when the rate limiter refuses the request', async () => {
    const pool = createInquiryPool();
    const app = createApp({
      pool,
      introspection: ALWAYS_SIGNED_OUT,
      rateLimiter: { consume: () => ({ allowed: false, retryAfterSeconds: 42 }) },
    });

    const response = await request(app).post(`/listings/${KNOWN_ID}/inquiries`).send(VALID_BODY);

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
    expect(pool.statements).toEqual([]);
  });

  it('never runs any SQL for a rate-limited request', async () => {
    const pool = createInquiryPool();
    const app = createApp({
      pool,
      introspection: ALWAYS_SIGNED_OUT,
      rateLimiter: { consume: () => ({ allowed: false, retryAfterSeconds: 1 }) },
    });

    await request(app).post(`/listings/${KNOWN_ID}/inquiries`).send(VALID_BODY);

    expect(pool.statements).toEqual([]);
  });

  it('consent adds a recipient and never replaces the listing-agent route: the listing is still checked and the inquiry still created', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app)
      .post(`/listings/${KNOWN_ID}/inquiries`)
      .send({ ...VALID_BODY, consentToContact: true });

    expect(response.status).toBe(201);
    // No fee/agent-routing mechanism exists yet (out of scope); this only asserts that a
    // consented inquiry still goes through the SAME listing-existence and insert path as any
    // other inquiry, never a different one that could skip notifying the listing agent.
    const insert = pool.statements.find((sql) => sql.includes('INSERT INTO listing_inquiries'));
    expect(insert).toBeDefined();
  });

  it('is never returned by GET /listings or GET /listings/:id', async () => {
    const response = await request(createApp({ pool: createSearchPool() })).get('/listings');

    expect(JSON.stringify(response.body)).not.toMatch(/inquir/i);
  });

  it('treats hex-case permutations of the SAME listing id as one rate-limit key', async () => {
    const pool = createInquiryPool();
    let calls = 0;
    const app = createApp({
      pool,
      introspection: ALWAYS_SIGNED_OUT,
      rateLimiter: {
        consume: (_ip: string, listingId: string) => {
          calls += 1;
          // A real limiter keys on the lower-cased id; asserting on what routes.ts HANDS the
          // limiter is what would have caught the pre-fix bug (passing the raw, mixed-case path
          // segment straight through).
          expect(listingId).toBe(listingId.toLowerCase());
          return { allowed: true, retryAfterSeconds: 0 };
        },
      },
    });

    await request(app).post(`/listings/${KNOWN_ID.toUpperCase()}/inquiries`).send(VALID_BODY);

    expect(calls).toBe(1);
  });

  it('reports a malformed JSON body as 400, not 500', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app)
      .post(`/listings/${KNOWN_ID}/inquiries`)
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(response.status).toBe(400);
  });

  it('reports an oversized body as a 4xx, not 500', async () => {
    const pool = createInquiryPool();
    const app = createApp({ pool, introspection: ALWAYS_SIGNED_OUT, rateLimiter: ALWAYS_ALLOW });

    const response = await request(app)
      .post(`/listings/${KNOWN_ID}/inquiries`)
      .send({ ...VALID_BODY, message: 'x'.repeat(100_000) });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
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
      '/listings/{id}/inquiries',
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
