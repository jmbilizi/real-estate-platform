import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from '../listings/repository';
import { cardDbRowFixture } from '../listings/test-fixtures';
import { clearCentreCache } from './candidates';
import { REDACTED, redactProfile } from './redact';
import { clearColdCache } from './service';

const ID = '018f2f2a-6d1b-7c3d-8b2e-000000000001';
const BODY = {
  profile: {
    items: [{ listingId: ID, kind: 'view', side: 'sale', at: 1760000000000 }],
    places: ['Alexandria, VA'],
  },
  target: { city: 'Alexandria', state: 'VA', lat: 38.8, lng: -77.05 },
  radiusKm: 8,
  side: 'sale',
};

function recordingPool(fail = false): ReadPool & { statements: string[] } {
  const statements: string[] = [];
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    statements.push(text);
    if (fail && text.includes('WITH base')) return Promise.reject(new Error('boom'));
    return Promise.resolve({ rows: [] as T[] });
  };
  return {
    statements,
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
}

beforeEach(() => {
  clearColdCache();
  clearCentreCache();
});

describe('POST /home-feed', () => {
  it('answers 200 no-store with modelVersion and variant', async () => {
    const pool = recordingPool();
    const res = await request(createApp({ pool })).post('/home-feed').send(BODY);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ modelVersion: 'v1', variant: 'v1', rows: [] });
  });

  it('bounds the read: statement timeout, read only, LIMIT, no count', async () => {
    const pool = recordingPool();
    await request(createApp({ pool })).post('/home-feed').send(BODY);
    const sql = pool.statements.join('\n');
    expect(sql).toContain('BEGIN READ ONLY');
    expect(sql).toMatch(/SET LOCAL statement_timeout = \d+/);
    expect(sql).toContain('LIMIT 400');
    expect(sql).toContain('ST_DWithin');
    expect(sql).not.toMatch(/count\(\*\)::int AS total/);
  });

  it('rejects an unknown field and names it', async () => {
    const res = await request(createApp({ pool: recordingPool() }))
      .post('/home-feed')
      .send({ ...BODY, schoolRating: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('schoolRating');
  });

  it('rejects an unknown field inside the profile without echoing a value', async () => {
    const res = await request(createApp({ pool: recordingPool() }))
      .post('/home-feed')
      .send({ ...BODY, profile: { ...BODY.profile, ethnicity: 'secret-value' } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-value');
  });

  it('never logs the profile when a read fails', async () => {
    const errors: unknown[][] = [];
    const record = (...args: unknown[]): void => {
      errors.push(args);
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(record);
    const warn = jest.spyOn(console, 'warn').mockImplementation(record);
    try {
      const res = await request(createApp({ pool: recordingPool(true) }))
        .post('/home-feed')
        .send(BODY);
      expect(res.status).toBe(200);
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).not.toContain(ID);
      expect(JSON.stringify(errors)).not.toContain('Alexandria, VA');
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('statement timeout degrades to the fallback feed', () => {
  const timeout = Object.assign(new Error('canceling statement due to statement timeout'), {
    code: '57014',
  });

  function timingOutPool(): ReadPool & { statements: string[] } {
    const statements: string[] = [];
    const query = <T>(text: string): Promise<{ rows: T[] }> => {
      statements.push(text);
      if (text.includes('WITH base')) return Promise.reject(timeout);
      if (text.includes('FROM listing_popularity_14d pop\n      JOIN')) {
        const rows = Array.from({ length: 6 }, (_, i) => ({
          ...cardDbRowFixture({
            id: `018f2f2a-6d1b-7c3d-8b2e-00000000010${i}`,
            property_id: `018f2f2a-6d1b-7c3d-8b2f-00000000010${i}`,
            office_name: `Office ${i}`,
            zip: `2000${i}`,
          }),
          media_is_primary: true,
          photo_count: 5,
          pop_score: 0.5,
          dist_km: null,
        }));
        return Promise.resolve({ rows: rows as unknown as T[] });
      }
      return Promise.resolve({ rows: [] as T[] });
    };
    return {
      statements,
      query,
      connect: () => Promise.resolve({ query, release: () => undefined }),
    };
  }

  it('answers 200 with variant fallback and logs a warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const res = await request(createApp({ pool: timingOutPool() }))
        .post('/home-feed')
        .send({ ...BODY, radiusKm: null });
      expect(res.status).toBe(200);
      expect(res.body.variant).toBe('fallback');
      expect(res.body.rows.length).toBeGreaterThan(0);
      for (const row of res.body.rows) expect(row.variant).toBe('fallback');
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain(ID);
    } finally {
      warn.mockRestore();
    }
  });

  it('still answers 200 with no rows when the fallback read fails too', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = (): Promise<never> => Promise.reject(timeout);
    const pool: ReadPool = {
      query: failing,
      connect: () => Promise.resolve({ query: failing, release: () => undefined }),
    };
    try {
      const res = await request(createApp({ pool })).post('/home-feed').send(BODY);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ modelVersion: 'v1', variant: 'fallback', rows: [] });
    } finally {
      warn.mockRestore();
    }
  });

  it('runs the profile read under the statement timeout', async () => {
    const pool = recordingPool();
    await request(createApp({ pool })).post('/home-feed').send(BODY);
    const first = pool.statements.findIndex((s) => s.includes('v.id = ANY($1::uuid[])'));
    expect(first).toBeGreaterThan(-1);
    const before = pool.statements.slice(0, first);
    expect(before.some((s) => s.includes('statement_timeout'))).toBe(true);
  });
});

describe('redactProfile', () => {
  it('replaces profile at any depth', () => {
    expect(
      redactProfile({ a: 1, req: { body: { profile: { items: [1] }, side: 'sale' } } }),
    ).toEqual({ a: 1, req: { body: { profile: REDACTED, side: 'sale' } } });
  });
});
