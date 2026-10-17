import request from 'supertest';
import { createApp } from '../app';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';

const ACCOUNT = '0190a000-0000-7000-8000-0000000000a1';
const ANON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function createPool(): ReadPool & { recorded: { sql: string; values: unknown[] }[] } {
  const recorded: { sql: string; values: unknown[] }[] = [];
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    return Promise.resolve({ rows: [] as T[] });
  };
  return { recorded, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

const signedIn: IntrospectionClient = {
  resolveAccountId: () => Promise.resolve(ACCOUNT),
  introspect: () => Promise.resolve({ kind: 'account', accountId: ACCOUNT, roles: [] }),
};
const signedOut: IntrospectionClient = {
  resolveAccountId: () => Promise.resolve(null),
  introspect: () => Promise.resolve({ kind: 'signed-out' }),
};
const down: IntrospectionClient = {
  resolveAccountId: () => Promise.resolve(null),
  introspect: () => Promise.resolve({ kind: 'unavailable' }),
};

const links = (pool: ReturnType<typeof createPool>) =>
  pool.recorded.filter((r) => /analytics_account_links/.test(r.sql));

describe('POST /analytics/account-link (#827)', () => {
  it('writes the anon id to account link for a verified session', async () => {
    const pool = createPool();
    const app = createApp({ pool, introspection: signedIn, analyticsEnabled: () => true });
    const res = await request(app)
      .post('/analytics/account-link')
      .set('Authorization', 'Bearer token-123')
      .send({ anon_id: ANON });
    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(links(pool)).toHaveLength(1);
    expect(links(pool)[0]?.values).toEqual([ACCOUNT, ANON]);
    expect(JSON.stringify(pool.recorded)).not.toContain('token-123');
  });

  it('writes nothing and answers 401 for a signed-out caller', async () => {
    const pool = createPool();
    const app = createApp({ pool, introspection: signedOut, analyticsEnabled: () => true });
    const res = await request(app).post('/analytics/account-link').send({ anon_id: ANON });
    expect(res.status).toBe(401);
    expect(links(pool)).toHaveLength(0);
  });

  it('answers 503 when account-service gives no answer', async () => {
    const pool = createPool();
    const app = createApp({ pool, introspection: down, analyticsEnabled: () => true });
    const res = await request(app).post('/analytics/account-link').send({ anon_id: ANON });
    expect(res.status).toBe(503);
    expect(links(pool)).toHaveLength(0);
  });

  it('stores nothing for Sec-GPC: 1', async () => {
    const pool = createPool();
    const app = createApp({ pool, introspection: signedIn, analyticsEnabled: () => true });
    const res = await request(app)
      .post('/analytics/account-link')
      .set('Sec-GPC', '1')
      .send({ anon_id: ANON });
    expect(res.status).toBe(204);
    expect(links(pool)).toHaveLength(0);
  });

  it('stores nothing when analytics is off', async () => {
    const pool = createPool();
    const app = createApp({ pool, introspection: signedIn, analyticsEnabled: () => false });
    const res = await request(app).post('/analytics/account-link').send({ anon_id: ANON });
    expect(res.status).toBe(204);
    expect(links(pool)).toHaveLength(0);
  });

  it('rejects an extra field and a bad anon id', async () => {
    const pool = createPool();
    const app = createApp({ pool, introspection: signedIn, analyticsEnabled: () => true });
    const extra = await request(app)
      .post('/analytics/account-link')
      .send({ anon_id: ANON, email: 'a@b.co' });
    expect(extra.status).toBe(400);
    const bad = await request(app).post('/analytics/account-link').send({ anon_id: 'short' });
    expect(bad.status).toBe(400);
    expect(links(pool)).toHaveLength(0);
  });
});
