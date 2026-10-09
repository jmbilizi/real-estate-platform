import request from 'supertest';
import {
  listingGroupsRequestSchema,
  NEIGHBORHOOD_PREVIEW_PHOTOS_MAX,
} from '@cribstop/property-contracts';
import { createApp } from '../app';
import { getBrokerGroups, getZipGroups } from './group-counts';
import type { ReadPool } from './repository';

/** A pool that records every statement and answers the group query with `rows`. */
function recordingPool(rows: unknown[]): { pool: ReadPool; texts: string[]; values: unknown[][] } {
  const texts: string[] = [];
  const values: unknown[][] = [];
  const query = <T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
    texts.push(text);
    values.push(params ?? []);
    return Promise.resolve({ rows: text.includes('WITH filtered') ? (rows as T[]) : [] });
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
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
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
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
    expect(sql).toContain('FROM listing_search_v v');
    expect(sql).toContain('left(v.zip, 5)');
    expect(sql).toContain('NOT EXISTS');
  });

  it('breaks ties by key and never reads a brokerage field to order', async () => {
    const { pool, texts } = recordingPool([]);
    await getZipGroups(pool, parse({ order: 'count' }));
    await getZipGroups(pool, parse({ order: 'name' }));
    const [byCount, byName] = texts.filter((text) => text.includes('WITH filtered'));
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

describe('group preview photos (#722)', () => {
  const photos = [{ url: 'https://cdn.example/a.jpg', listingId: 'a' }];

  it('maps preview photos onto ZIP and broker groups, and leaves the field out when empty', async () => {
    const rows = [
      { group_total: 2, listing_total: 3, key: 'k1', name: 'N1', count: 2, preview_photos: photos },
      { group_total: 2, listing_total: 3, key: 'k2', name: 'N2', count: 1, preview_photos: [] },
    ];
    const zips = await getZipGroups(recordingPool(rows).pool, parse({}));
    expect(zips.groups[0]?.previewPhotos).toEqual(photos);
    expect(zips.groups[1]).not.toHaveProperty('previewPhotos');
    const brokers = await getBrokerGroups(recordingPool(rows).pool, parse({}));
    expect(brokers.groups[0]?.previewPhotos).toEqual(photos);
    expect(brokers.groups[1]).not.toHaveProperty('previewPhotos');
  });

  it('picks the photos after the page limit, with the media display flag and the neighborhood count', async () => {
    const { pool, texts } = recordingPool([]);
    await getZipGroups(pool, parse({}));
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
    expect(sql).toContain('f.media_display_allowed OR m.retained_when_suppressed');
    expect(sql).toContain(`LIMIT ${NEIGHBORHOOD_PREVIEW_PHOTOS_MAX}`);
    expect(sql).toContain('f.group_key = page.group_key');
  });

  it('runs the search filter once: the photo lookup reads the filtered rows (#759)', async () => {
    const { pool, texts } = recordingPool([]);
    await getBrokerGroups(pool, parse({ zip: '22314' }));
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
    expect(sql).toContain('WITH filtered AS MATERIALIZED');
    expect(sql).toContain('FROM filtered f');
    // One source scan: the view, and no second copy of the filter or the collapse.
    expect(sql.split('FROM listing_search_v v').length).toBe(2);
    expect(sql.split('starts_with(v.zip').length).toBe(2);
  });
});

describe('getBrokerGroups (#722)', () => {
  it('maps the rows to groups with the office key and the name', async () => {
    const { pool } = recordingPool([
      { group_total: 2, listing_total: 5, key: '1001', name: 'Acme Realty', count: 3 },
      { group_total: 2, listing_total: 5, key: 'unlisted', name: 'Other / unlisted', count: 2 },
    ]);
    expect(await getBrokerGroups(pool, parse({ city: 'Bethesda', state: 'MD' }))).toEqual({
      groups: [
        { key: '1001', name: 'Acme Realty', count: 3 },
        { key: 'unlisted', name: 'Other / unlisted', count: 2 },
      ],
      total: 2,
      listingTotal: 5,
    });
  });

  it('groups by office key, never by name, and puts a missing key in `unlisted`', async () => {
    const { pool, texts } = recordingPool([]);
    await getBrokerGroups(pool, parse({ city: 'Bethesda', state: 'MD' }));
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
    expect(sql).toContain("COALESCE(v.office_key, 'unlisted') AS group_key");
    expect(sql).toContain('GROUP BY group_key');
    expect(sql).toContain('bool_and(office_key IS NULL)');
    expect(sql).toContain("'Other / unlisted'");
    // The name comes from the most recently updated listing of the group.
    expect(sql).toMatch(/array_agg\(office_name\s+ORDER BY modified_at DESC NULLS LAST, id DESC\)/);
  });

  it('reads the office key through a join to listings on the view source', async () => {
    const { pool, texts } = recordingPool([]);
    await getBrokerGroups(pool, parse({ city: 'Bethesda', state: 'MD', beds: '3' }));
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
    expect(sql).toContain('listing_search_v v JOIN listings l ON l.id = v.id');
    expect(sql).toContain("COALESCE(l.office_key, 'unlisted') AS group_key");
  });

  it('orders by count or by name, and breaks every tie by key', async () => {
    const { pool, texts } = recordingPool([]);
    await getBrokerGroups(pool, parse({ order: 'count' }));
    await getBrokerGroups(pool, parse({ order: 'name' }));
    const [byCount, byName] = texts.filter((text) => text.includes('WITH filtered'));
    expect(byCount).toContain('ORDER BY group_count DESC, group_key ASC');
    expect(byName).toContain('ORDER BY lower(group_name) ASC, group_key ASC');
  });

  it('reads no brokerage identity to rank: nothing names a brokerage in the ORDER BY', async () => {
    const { pool, texts } = recordingPool([]);
    await getBrokerGroups(pool, parse({}));
    const sql = texts.find((text) => text.includes('WITH filtered')) as string;
    expect(sql).not.toMatch(/real broker/i);
    expect(sql).not.toMatch(/featured/i);
  });
});

describe('GET /listings/brokers (#722)', () => {
  it('answers 200 with the groups, and 400 for an unknown parameter', async () => {
    const { pool } = recordingPool([
      { group_total: 1, listing_total: 2, key: '1001', name: 'Acme Realty', count: 2 },
    ]);
    const app = createApp({ pool });
    const ok = await request(app).get('/listings/brokers').query({ city: 'Bethesda' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      groups: [{ key: '1001', name: 'Acme Realty', count: 2 }],
      total: 1,
      listingTotal: 2,
    });
    expect((await request(app).get('/listings/brokers').query({ nope: '1' })).status).toBe(400);
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
