import request from 'supertest';
import { listingGroupsRequestSchema } from '@cribstop/property-contracts';
import { createApp } from '../app';
import { getZipGroups } from './group-counts';
import type { ReadPool } from './repository';

/** A pool that records every statement and answers the group query with `rows`. */
function recordingPool(rows: unknown[]): { pool: ReadPool; texts: string[]; values: unknown[][] } {
  const texts: string[] = [];
  const values: unknown[][] = [];
  const query = <T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
    texts.push(text);
    values.push(params ?? []);
    return Promise.resolve({ rows: text.includes('WITH grouped') ? (rows as T[]) : [] });
  };
  return {
    pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    texts,
    values,
  };
}

const parse = (query: Record<string, string>) => listingGroupsRequestSchema.parse(query);

describe('getZipGroups', () => {
  it('maps the rows to groups, a group total and a listing total', async () => {
    const { pool } = recordingPool([
      { group_total: 2, listing_total: 7, key: '20814', name: null, count: 4 },
      { group_total: 2, listing_total: 7, key: '20815', name: null, count: 3 },
    ]);
    const response = await getZipGroups(pool, parse({ city: 'Bethesda', state: 'MD' }));
    expect(response).toEqual({
      groups: [
        { key: '20814', count: 4 },
        { key: '20815', count: 3 },
      ],
      total: 2,
      listingTotal: 7,
    });
  });

  it('answers an empty page with its exact totals and no group', async () => {
    const { pool } = recordingPool([
      { group_total: 5, listing_total: 9, key: null, name: null, count: null },
    ]);
    const response = await getZipGroups(pool, parse({ offset: '100' }));
    expect(response).toEqual({ groups: [], total: 5, listingTotal: 9 });
  });

  it('reads listings with the collapse when the request has only scope filters', async () => {
    const { pool, texts } = recordingPool([]);
    await getZipGroups(pool, parse({ city: 'Bethesda', state: 'MD' }));
    const sql = texts.find((text) => text.includes('WITH grouped')) as string;
    expect(sql).toContain('FROM listings v');
    expect(sql).not.toContain('listing_search_v');
    expect(sql).toContain('left(v.zip5, 5)');
    // The #716 collapse is in the WHERE clause, so the counts equal the card count.
    expect(sql).toContain('NOT EXISTS');
    expect(texts).toContain('SET LOCAL jit = off');
  });

  it('reads the search view when the request has a filter beyond the scope', async () => {
    const { pool, texts } = recordingPool([]);
    await getZipGroups(pool, parse({ city: 'Bethesda', state: 'MD', beds: '3' }));
    const sql = texts.find((text) => text.includes('WITH grouped')) as string;
    expect(sql).toContain('FROM listing_search_v v');
    expect(sql).toContain('left(v.zip, 5)');
    expect(sql).toContain('NOT EXISTS');
  });

  it('breaks ties by key and never reads a brokerage field to order', async () => {
    const { pool, texts } = recordingPool([]);
    await getZipGroups(pool, parse({ order: 'count' }));
    await getZipGroups(pool, parse({ order: 'name' }));
    const [byCount, byName] = texts.filter((text) => text.includes('WITH grouped'));
    expect(byCount).toContain('ORDER BY group_count DESC, group_key ASC');
    expect(byName).toContain('ORDER BY group_key ASC');
    for (const sql of [byCount as string, byName as string]) {
      const orders = [...sql.matchAll(/ORDER BY ([^\n)]*)/g)].map((match) => match[1]);
      expect(orders.join(' ')).not.toMatch(/office|broker/i);
    }
  });

  it('binds minCount, limit and offset as parameters', async () => {
    const { pool, values } = recordingPool([]);
    await getZipGroups(pool, parse({ minCount: '2', limit: '10', offset: '20' }));
    const params = values.find((v) => v.length > 0) as unknown[];
    expect(params.slice(-3)).toEqual([2, 10, 20]);
  });
});

describe('GET /listings/zips', () => {
  it('answers 200 with the groups and a shared cache policy', async () => {
    const { pool } = recordingPool([
      { group_total: 1, listing_total: 4, key: '20814', name: null, count: 4 },
    ]);
    const response = await request(createApp({ pool })).get('/listings/zips').query({
      city: 'Bethesda',
      state: 'MD',
      limit: '1',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      groups: [{ key: '20814', count: 4 }],
      total: 1,
      listingTotal: 4,
    });
    expect(response.headers['cache-control']).toContain('s-maxage=300');
  });

  it('answers 400 for an unknown parameter and for listing paging', async () => {
    const { pool } = recordingPool([]);
    const app = createApp({ pool });
    expect((await request(app).get('/listings/zips').query({ nope: '1' })).status).toBe(400);
    expect((await request(app).get('/listings/zips').query({ page: '2' })).status).toBe(400);
  });
});
