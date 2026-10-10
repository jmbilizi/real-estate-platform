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

function createPool(): ReadPool & { recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    return Promise.resolve({ rows: [] as T[] });
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
    const { app } = appFor(ACCOUNT_A);
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const past = await request(app)
      .put(`/looking-for/${PREF_ID}`)
      .send(body({ whenStart: day(-3) }));
    expect(past.status).toBe(400);
    expect(past.body.error.fields).toEqual(['whenStart']);
    const yesterday = await request(app)
      .put(`/looking-for/${PREF_ID}`)
      .send(body({ whenStart: day(-1) }));
    expect(yesterday.status).not.toBe(400);
  });

  it('refuses a malformed id with the field named', async () => {
    const { app } = appFor(ACCOUNT_A);
    const response = await request(app).put('/looking-for/not-a-uuid').send(body());
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toEqual(['id']);
  });
});
