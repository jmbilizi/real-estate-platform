import request from 'supertest';
import { createApp } from '../app';
import { cellSizeFor, snapToCells } from './map-query';
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

function mapPool(pinRows: number, clusterRows: unknown[] = []): ReadPool & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = <T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    calls.push({ text, values });
    if (text.includes('GROUP BY floor')) {
      return Promise.resolve({ rows: clusterRows as T[] });
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
  it('returns pins at or below the threshold, with only the pin fields', async () => {
    const pool = mapPool(3);
    const response = await request(createApp({ pool, mapPinThreshold: 3 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS, zoom: '14', city: 'Washington' });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe('pins');
    expect(response.body.count).toBe(3);
    expect(response.body.sampleCount).toBe(1);
    expect(Object.keys(response.body.pins[0]).sort()).toEqual(
      ['id', 'latitude', 'listingType', 'longitude', 'price', 'status'].sort(),
    );
    expect(response.body.pins[0].price).toBe(450000);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(pool.calls.some((c) => c.text.includes('GROUP BY floor'))).toBe(false);
  });

  it('filters the masked coordinates with the search WHERE clause and no paging', async () => {
    const pool = mapPool(1);
    await request(createApp({ pool, mapPinThreshold: 10 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS, zoom: '14', city: 'Washington' });

    const pinQuery = pool.calls.find((c) => c.text.includes('FROM listing_search_v'));
    expect(pinQuery?.text).toContain('v.listing_type = ANY(');
    expect(pinQuery?.text).toContain('lower(v.city) = lower(');
    expect(pinQuery?.text).toMatch(/v\.latitude BETWEEN \$\d+ AND \$\d+/);
    expect(pinQuery?.text).toMatch(/v\.longitude BETWEEN \$\d+ AND \$\d+/);
    expect(pinQuery?.text).not.toMatch(/street_line|l\.latitude|p\.geog|OFFSET/);
    // Threshold + 1 is the last bound value: one extra row says "more than the threshold".
    expect(pinQuery?.values.at(-1)).toBe(11);
  });

  it('returns clusters above the threshold', async () => {
    const cluster = {
      count: 40,
      in_view_count: 40,
      in_view_sample_count: 0,
      latitude: 38.9,
      longitude: -77.03,
      west: -77.05,
      south: 38.88,
      east: -77.01,
      north: 38.92,
    };
    const pool = mapPool(4, [
      cluster,
      { ...cluster, count: 5, in_view_count: 2, in_view_sample_count: 1 },
    ]);
    const response = await request(createApp({ pool, mapPinThreshold: 3 }))
      .get('/listings/map')
      .query({ bounds: DC_BOUNDS, zoom: '11' });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe('clusters');
    expect(response.body.count).toBe(42);
    expect(response.body.sampleCount).toBe(1);
    expect(response.body.clusters).toHaveLength(2);
    expect(response.body.clusters[0]).toEqual({
      count: 40,
      latitude: 38.9,
      longitude: -77.03,
      bounds: { west: -77.05, south: 38.88, east: -77.01, north: 38.92 },
    });
  });

  it.each([
    [{ zoom: '12' }],
    [{ bounds: DC_BOUNDS }],
    [{ bounds: '-76,38,-77,39', zoom: '12' }],
    [{ bounds: DC_BOUNDS, zoom: '23' }],
    [{ bounds: DC_BOUNDS, zoom: '12', page: '2' }],
  ])('rejects %j with 400', async (query) => {
    const response = await request(createApp({ pool: mapPool(0), mapPinThreshold: 3 }))
      .get('/listings/map')
      .query(query);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });
});

describe('cluster grid', () => {
  const region = { west: -80, south: 36.5, east: -74.5, north: 40.5 };

  it('never exceeds 60 cells per axis', () => {
    const cell = cellSizeFor(region, 22);
    expect((region.east - region.west) / cell).toBeLessThanOrEqual(60 + 1e-9);
  });

  it('snaps the viewport outward to whole cells', () => {
    const cell = cellSizeFor(region, 7);
    const snapped = snapToCells(region, cell);
    expect(snapped.west).toBeLessThanOrEqual(region.west);
    expect(snapped.north).toBeGreaterThanOrEqual(region.north);
    expect(Number.isInteger(Math.round((snapped.east - snapped.west) / cell))).toBe(true);
  });
});
