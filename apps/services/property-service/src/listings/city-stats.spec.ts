import request from 'supertest';
import { cityStatsRequestSchema } from '@cribstop/property-contracts';
import { createApp } from '../app';
import { getCityStats } from './city-stats';
import type { ReadPool } from './repository';

function recordingPool(row: Record<string, unknown>): { pool: ReadPool; texts: string[] } {
  const texts: string[] = [];
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    texts.push(text);
    return Promise.resolve({ rows: text.includes('WITH base') ? [row as T] : [] });
  };
  return {
    pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    texts,
  };
}

const ROW = {
  listing_count: 9,
  data_updated_at: new Date('2026-10-01T12:00:00.000Z'),
  price_n: 9,
  price_median: '512500.4',
  dom_n: 6,
  dom_median: 17.5,
  ppsf_n: 5,
  ppsf_median: '301.49',
};

const parse = (query: Record<string, string>) => cityStatsRequestSchema.parse(query);

describe('getCityStats', () => {
  it('rounds each median and reports the input counts and the data date', async () => {
    const { pool } = recordingPool(ROW);
    expect(await getCityStats(pool, parse({ city: 'Bethesda', state: 'MD' }))).toEqual({
      listingCount: 9,
      medianListPrice: { value: 512500, inputCount: 9 },
      medianDaysOnMarket: { value: 18, inputCount: 6 },
      medianPricePerSqft: { value: 301, inputCount: 5 },
      dataUpdatedAt: '2026-10-01T12:00:00.000Z',
    });
  });

  it('returns null, never a number, for a statistic with fewer than 5 inputs', async () => {
    const { pool } = recordingPool({ ...ROW, dom_n: 4, dom_median: 20, ppsf_n: 1 });
    const stats = await getCityStats(pool, parse({ city: 'Bethesda', state: 'MD' }));
    expect(stats.medianDaysOnMarket).toEqual({ value: null, inputCount: 4 });
    expect(stats.medianPricePerSqft).toEqual({ value: null, inputCount: 1 });
    expect(stats.medianListPrice.value).toBe(512500);
  });

  it('answers a city with no listing with zero counts and a null data date', async () => {
    const { pool } = recordingPool({
      listing_count: 0,
      data_updated_at: null,
      price_n: 0,
      price_median: null,
      dom_n: 0,
      dom_median: null,
      ppsf_n: 0,
      ppsf_median: null,
    });
    const stats = await getCityStats(pool, parse({ city: 'Nowhere', state: 'ZZ' }));
    expect(stats.listingCount).toBe(0);
    expect(stats.medianListPrice).toEqual({ value: null, inputCount: 0 });
    expect(stats.dataUpdatedAt).toBeNull();
  });

  it('applies the display flags, the sample and sold exclusions and the collapse in SQL', async () => {
    const { pool, texts } = recordingPool(ROW);
    await getCityStats(pool, parse({ city: 'Bethesda', state: 'MD' }));
    const sql = texts.find((text) => text.includes('WITH base')) as string;
    expect(sql).toContain('v.price_display_allowed');
    expect(sql).toContain('v.days_on_market_display_allowed');
    expect(sql).toContain("v.consumer_status = 'Active'");
    expect(sql).toContain('v.is_sample OR p.is_sample');
    expect(sql).toContain('v.internet_display_allowed');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).not.toMatch(/street_line|address/);
    expect(texts).toContain('SET LOCAL jit = off');
  });
});

describe('GET /listings/city-stats', () => {
  const app = (pool: ReadPool) => createApp({ pool });

  it('rejects a request with no city or state', async () => {
    const { pool } = recordingPool(ROW);
    const response = await request(app(pool)).get('/listings/city-stats?state=MD');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('rejects an unknown parameter', async () => {
    const { pool } = recordingPool(ROW);
    const response = await request(app(pool)).get(
      '/listings/city-stats?city=Bethesda&state=MD&fields=price',
    );
    expect(response.status).toBe(400);
  });

  it('answers with the shared cache policy', async () => {
    const { pool } = recordingPool(ROW);
    const response = await request(app(pool)).get('/listings/city-stats?city=Bethesda&state=MD');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('s-maxage=300');
    expect(response.body.listingCount).toBe(9);
  });
});
