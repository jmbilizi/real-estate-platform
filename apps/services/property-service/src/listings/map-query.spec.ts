import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from './repository';

const DC_BOUNDS = '-77.12,38.79,-76.91,38.996';

function pinRow(index: number, isSample = false) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    latitude: 38.9 + index / 10_000,
    longitude: -77.03,
    price: '450000',
    status: 'Active',
    listing_type: 'sale',
    is_sample: isSample,
  };
}

interface Recorded {
  text: string;
  values: unknown[];
}

/** `pinRows` rows come back from the pin query. `viewportTotal` is the count query answer. */
function mapPool(pinRows: number, viewportTotal = pinRows): ReadPool & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = <T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    calls.push({ text, values });
    if (text.includes('count(*)')) {
      return Promise.resolve({ rows: [{ total: viewportTotal }] as T[] });
    }
    if (text.includes('FROM listing_search_v')) {
      return Promise.resolve({
        rows: Array.from({ length: pinRows }, (_, i) => pinRow(i, i === 0)) as T[],
      });
    }
    return Promise.resolve({ rows: [] });
  };
  return {
    calls,
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
}

describe('GET /listings/map', () => {
  it('returns one pin per listing with only the pin fields, and no cluster shape', async () => {
    const pool = mapPool(3);
    const response = await request(createApp({ pool, mapPinCap: 10 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS, city: 'Washington' });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['pins', 'sampleCount', 'total']);
    expect(response.body.total).toBe(3);
    expect(response.body.pins).toHaveLength(3);
    expect(response.body.sampleCount).toBe(1);
    expect(Object.keys(response.body.pins[0]).sort()).toEqual(
      ['id', 'latitude', 'listingType', 'longitude', 'price', 'status'].sort(),
    );
    expect(response.body.pins[0].price).toBe(450000);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(pool.calls.some((c) => /GROUP BY|clusters/i.test(c.text))).toBe(false);
  });

  it('skips the count query when the pins are the whole viewport', async () => {
    const pool = mapPool(2);
    await request(createApp({ pool, mapPinCap: 10 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS });

    expect(pool.calls.some((c) => c.text.includes('count(*)'))).toBe(false);
  });

  it('caps the pins at the cap, newest first, and reports the full total', async () => {
    const pool = mapPool(3, 4200);
    const response = await request(createApp({ pool, mapPinCap: 3 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS });

    expect(response.status).toBe(200);
    expect(response.body.pins).toHaveLength(3);
    expect(response.body.total).toBe(4200);
    const pinQuery = pool.calls.find((c) => c.text.includes('ORDER BY'));
    expect(pinQuery?.text).toContain('ORDER BY v.last_updated DESC, v.id DESC');
    expect(pinQuery?.values.at(-1)).toBe(3);
  });

  it('filters the masked coordinates with the search WHERE clause and no paging', async () => {
    const pool = mapPool(1);
    await request(createApp({ pool, mapPinCap: 10 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS, city: 'Washington' });

    const pinQuery = pool.calls.find((c) => c.text.includes('FROM listing_search_v'));
    expect(pinQuery?.text).toContain('v.listing_type = ANY(');
    expect(pinQuery?.text).toContain('lower(v.city) = lower(');
    expect(pinQuery?.text).toMatch(/v\.latitude BETWEEN \$\d+ AND \$\d+/);
    expect(pinQuery?.text).toMatch(/v\.longitude BETWEEN \$\d+ AND \$\d+/);
    // `v.latitude` is the masked column. A listing whose address display is not allowed has NULL
    // there, so the range test drops it. The query never reads the unmasked table columns.
    expect(pinQuery?.text).not.toMatch(/street_line|l\.latitude|p\.geog|OFFSET/);
  });

  it.each([
    [{}],
    [{ bounds: '-76,38,-77,39' }],
    [{ bounds: DC_BOUNDS, zoom: '12' }],
    [{ bounds: DC_BOUNDS, page: '2' }],
  ])('rejects %j with 400', async (query) => {
    const response = await request(createApp({ pool: mapPool(0), mapPinCap: 3 }))
      .get('/listings/map')
      .query(query);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });
});
