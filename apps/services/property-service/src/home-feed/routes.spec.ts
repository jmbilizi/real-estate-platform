import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from '../listings/repository';
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

  it('never logs the profile when the read fails', async () => {
    const errors: unknown[][] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    try {
      const res = await request(createApp({ pool: recordingPool(true) }))
        .post('/home-feed')
        .send(BODY);
      expect(res.status).toBe(500);
      expect(JSON.stringify(errors)).not.toContain(ID);
      expect(JSON.stringify(errors)).not.toContain('Alexandria, VA');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('redactProfile', () => {
  it('replaces profile at any depth', () => {
    expect(
      redactProfile({ a: 1, req: { body: { profile: { items: [1] }, side: 'sale' } } }),
    ).toEqual({ a: 1, req: { body: { profile: REDACTED, side: 'sale' } } });
  });
});
