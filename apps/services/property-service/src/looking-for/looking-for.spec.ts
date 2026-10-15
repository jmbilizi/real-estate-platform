import request from 'supertest';
import { createApp } from '../app';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';

/** The looking-for routes (#768) against a FAKE pool that records each statement. */

const ACCOUNT_A = '0190a000-0000-7000-8000-00000000000a';
const PREF_ID = '0190a000-0000-7000-8000-0000000000c1';
const place = { kind: 'city', state: 'VA', city: 'Alexandria' };

const signedInAs = (accountId: string | null): IntrospectionClient => ({
  resolveAccountId: () => Promise.resolve(accountId),
});

interface Recorded {
  sql: string;
  values: unknown[];
}

const savedRow = {
  id: PREF_ID,
  intent: 'buy',
  places: [place],
  price_min: null,
  price_max: null,
  beds_min: null,
  baths_min: null,
  home_types: [],
  when_start: '2026-10-09',
  when_end: null,
  created_at: new Date('2026-10-10T12:00:00Z'),
  updated_at: new Date('2026-10-10T12:00:00Z'),
};

function createPool(): ReadPool & { recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    const rows = sql.includes('INSERT')
      ? [savedRow]
      : sql.includes('count(*)')
        ? [{ count: '0' }]
        : [];
    return Promise.resolve({ rows: rows as T[] });
  };
  return { recorded, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

const appFor = (accountId: string | null, pool = createPool()) => ({
  pool,
  app: createApp({ pool, introspection: signedInAs(accountId) }),
});

const body = (overrides: Record<string, unknown> = {}) => ({
  intent: 'buy',
  places: [place],
  ...overrides,
});

describe('looking-for routes', () => {
  it('answers 401 with no statement when signed out', async () => {
    const { app, pool } = appFor(null);
    const responses = [
      await request(app).get('/looking-for'),
      await request(app).put(`/looking-for/${PREF_ID}`).send(body()),
      await request(app).delete(`/looking-for/${PREF_ID}`),
    ];
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect(pool.recorded).toEqual([]);
  });

  it('scopes the list and the delete to the calling account', async () => {
    const { app, pool } = appFor(ACCOUNT_A);
    const list = await request(app).get('/looking-for');
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ items: [], max: 5 });
    expect((await request(app).delete(`/looking-for/${PREF_ID}`)).status).toBe(204);
    expect(pool.recorded.map((r) => r.values[0])).toEqual([ACCOUNT_A, ACCOUNT_A]);
  });

  it('ignores an account id in the body and names the refused field', async () => {
    const { app, pool } = appFor(ACCOUNT_A);
    const response = await request(app)
      .put(`/looking-for/${PREF_ID}`)
      .send(body({ accountId: 'other' }));
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual(['accountId']);
    expect(pool.recorded).toEqual([]);
  });

  it('refuses a start date before yesterday in UTC and accepts yesterday', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-10T12:00:00Z'));
    try {
      const { app } = appFor(ACCOUNT_A);
      const past = await request(app)
        .put(`/looking-for/${PREF_ID}`)
        .send(body({ whenStart: '2026-10-08' }));
      expect(past.status).toBe(400);
      expect(past.body.error.fields).toEqual(['whenStart']);
      const yesterday = await request(app)
        .put(`/looking-for/${PREF_ID}`)
        .send(body({ whenStart: '2026-10-09' }));
      expect(yesterday.status).toBe(201);
      expect(yesterday.body.whenStart).toBe('2026-10-09');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('names the parent field for a nested extra key and the key for a top-level one', async () => {
    const { app } = appFor(ACCOUNT_A);
    const nested = await request(app)
      .put(`/looking-for/${PREF_ID}`)
      .send(body({ places: [{ ...place, extra: 1 }] }));
    expect(nested.body.error.fields).toEqual(['places']);
    const top = await request(app)
      .put(`/looking-for/${PREF_ID}`)
      .send(body({ notes: 'x' }));
    expect(top.body.error.fields).toEqual(['notes']);
  });

  it('refuses a malformed id with the field named', async () => {
    const { app } = appFor(ACCOUNT_A);
    const response = await request(app).put('/looking-for/not-a-uuid').send(body());
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual(['id']);
  });
});
