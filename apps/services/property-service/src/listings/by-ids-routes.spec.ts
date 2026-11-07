import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from './repository';
import { cardDbRowFixture } from './test-fixtures';

/** `GET /listings/by-ids` (#76). A fake pool holds the ids it can resolve. */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function poolHolding(held: readonly string[]): ReadPool & { readonly calls: unknown[][] } {
  const calls: unknown[][] = [];
  const query = <T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    if (!text.includes('FROM')) return Promise.resolve({ rows: [] });
    calls.push(values);
    const wanted = (values[0] as string[]) ?? [];
    // The database returns rows in its own order, so the route must restore the caller's order.
    const rows = [...held]
      .reverse()
      .filter((h) => wanted.includes(h))
      .map((h) => cardDbRowFixture({ id: h }));
    return Promise.resolve({ rows: rows as T[] });
  };
  return {
    calls,
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
}

describe('GET /listings/by-ids (#76)', () => {
  it('answers card rows in the caller order, with attribution on every row', async () => {
    const response = await request(createApp({ pool: poolHolding([id(1), id(2), id(3)]) })).get(
      `/listings/by-ids?ids=${id(3)},${id(1)},${id(2)}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.body.results.map((r: { id: string }) => r.id)).toEqual([id(3), id(1), id(2)]);
    for (const row of response.body.results) {
      expect(row.brokerName).toBe('Real Broker, LLC');
      expect(row.listedBy).toBeTruthy();
      expect(row).not.toHaveProperty('isSaved');
    }
    expect(response.body.total).toBe(3);
  });

  it('matches an id sent in upper case and answers a repeated id once', async () => {
    const response = await request(createApp({ pool: poolHolding([id(1)]) })).get(
      `/listings/by-ids?ids=${id(1).toUpperCase()},${id(1)}`,
    );

    expect(response.body.results.map((r: { id: string }) => r.id)).toEqual([id(1)]);
  });

  it('leaves out an id that does not resolve and answers 200', async () => {
    const response = await request(createApp({ pool: poolHolding([id(1)]) })).get(
      `/listings/by-ids?ids=${id(9)}&ids=${id(1)}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.results.map((r: { id: string }) => r.id)).toEqual([id(1)]);
  });

  it('answers an empty list when no id resolves', async () => {
    const response = await request(createApp({ pool: poolHolding([]) })).get(
      `/listings/by-ids?ids=${id(9)}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
    expect(response.body.pageCount).toBe(0);
  });

  it('answers a set at the cap and rejects a set over it', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => id(i + 1));
    const app = createApp({ pool: poolHolding(ids) });

    const at = await request(app).get(`/listings/by-ids?ids=${ids.slice(0, 50).join(',')}`);
    expect(at.status).toBe(200);
    expect(at.body.results).toHaveLength(50);

    const over = await request(app).get(`/listings/by-ids?ids=${ids.join(',')}`);
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('invalid_request');
  });

  it('rejects a missing set, a malformed id and an unknown parameter, with no query', async () => {
    const pool = poolHolding([]);
    const app = createApp({ pool });

    expect((await request(app).get('/listings/by-ids')).status).toBe(400);
    expect((await request(app).get('/listings/by-ids?ids=nope')).status).toBe(400);
    expect((await request(app).get(`/listings/by-ids?ids=${id(1)}&fields=id`)).status).toBe(400);
    expect(pool.calls).toHaveLength(0);
  });
});
