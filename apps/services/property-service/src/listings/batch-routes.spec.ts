import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from './repository';
import { cardDbRowFixture } from './test-fixtures';

/**
 * `POST /listings/batch` (#960). A fake pool answers by the place in the SQL parameters, so a
 * test can say which scopes hold listings.
 */

function poolWithListingsIn(
  places: readonly string[],
): ReadPool & { readonly queries: unknown[][] } {
  const queries: unknown[][] = [];
  const query = <T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    if (text.includes('count(*)::int AS total'))
      return Promise.resolve({ rows: [{ total: 1 }] as T[] });
    if (!text.includes('FROM')) return Promise.resolve({ rows: [] });
    queries.push(values);
    const flat = values.map((v) => String(v).toLowerCase());
    const hit =
      !flat.includes('nowhereville') && places.some((p) => flat.includes(p.toLowerCase()));
    const unscoped = places.includes('*') && !flat.some((v) => v === 'nowhereville' || v === 'xx');
    return Promise.resolve({ rows: hit || unscoped ? ([cardDbRowFixture()] as T[]) : [] });
  };
  return {
    queries,
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
}

describe('POST /listings/batch (#960)', () => {
  it('answers every row in request order with a public, cacheable response', async () => {
    const response = await request(createApp({ pool: poolWithListingsIn(['*']) }))
      .post('/listings/batch')
      .send({
        rows: [
          { id: 'a', params: { listingType: 'sale', sort: 'newest', skipTotal: 'true' } },
          { id: 'b', params: { listingType: 'rent', skipTotal: 'true' } },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.body.rows.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
    expect(response.body.rows[0].result.results).toHaveLength(1);
    expect(response.body.rows[0].result.results[0]).not.toHaveProperty('isSaved');
  });

  it('widens an empty city to the state, then to no place', async () => {
    const response = await request(createApp({ pool: poolWithListingsIn(['md']) }))
      .post('/listings/batch')
      .send({
        rows: [
          {
            id: 'near',
            widen: true,
            params: { city: 'Nowhereville', state: 'MD', skipTotal: 'true' },
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.rows[0].scope).toEqual({ state: 'MD' });
    expect(response.body.rows[0].result.results).toHaveLength(1);
  });

  it('keeps the requested scope when widening is off', async () => {
    const response = await request(createApp({ pool: poolWithListingsIn([]) }))
      .post('/listings/batch')
      .send({
        rows: [{ id: 'x', params: { city: 'Nowhereville', state: 'MD', skipTotal: 'true' } }],
      });

    expect(response.body.rows[0].scope).toEqual({ city: 'Nowhereville', state: 'MD' });
    expect(response.body.rows[0].result.results).toHaveLength(0);
  });

  it('reports a bad row on its own and still answers the others, with no-store', async () => {
    const response = await request(createApp({ pool: poolWithListingsIn(['*']) }))
      .post('/listings/batch')
      .send({
        rows: [
          { id: 'bad', params: { nonsense: '1' } },
          { id: 'ok', params: { listingType: 'sale', skipTotal: 'true' } },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.rows[0].error.code).toBe('invalid_request');
    expect(response.body.rows[1].result.results).toHaveLength(1);
  });

  it('isolates a database failure to its row', async () => {
    const failing: ReadPool = {
      query: () => Promise.reject(new Error('boom')),
      connect: () => Promise.reject(new Error('boom')),
    };
    const response = await request(createApp({ pool: failing }))
      .post('/listings/batch')
      .send({ rows: [{ id: 'a', params: {} }] });

    expect(response.status).toBe(200);
    expect(response.body.rows[0].error.code).toBe('internal_error');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('answers a slow row with its own error and still answers the fast rows', async () => {
    process.env.LISTINGS_BATCH_ROW_TIMEOUT_MS = '100';
    try {
      const fast = poolWithListingsIn(['*']);
      const slowQuery = <T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> => {
        const slow = JSON.stringify(values ?? []).includes('rent');
        return slow
          ? new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 1500))
          : fast.query<T>(text, values);
      };
      const pool: ReadPool = {
        query: slowQuery,
        connect: () => Promise.resolve({ query: slowQuery, release: () => undefined }),
      };
      const started = Date.now();
      const response = await request(createApp({ pool }))
        .post('/listings/batch')
        .send({
          rows: [
            { id: 'fast', params: { listingType: 'sale', skipTotal: 'true' } },
            { id: 'slow', params: { listingType: 'rent', skipTotal: 'true' } },
          ],
        });

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.rows[0].result.results).toHaveLength(1);
      expect(response.body.rows[1].error.code).toBe('internal_error');
    } finally {
      delete process.env.LISTINGS_BATCH_ROW_TIMEOUT_MS;
    }
  });

  it('rejects an unknown field, an empty batch and a batch over the limit', async () => {
    const app = createApp({ pool: poolWithListingsIn([]) });
    const rows = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, params: {} }));
    for (const body of [{ rows: [], x: 1 }, { rows: [] }, { rows }]) {
      const response = await request(app).post('/listings/batch').send(body);
      expect(response.status).toBe(400);
    }
  });
});
