import request from 'supertest';

import { createApp } from '../app';
import type { ReadPool } from '../listings/repository';
import { isAuthorized, parseSyncRequest } from './bright-sync-routes';

const TOKEN = 'a-long-random-admin-token';
const RUN_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    mode: 'incremental',
    scope: {},
    status: 'requested',
    feed_tier: null,
    counts: {},
    cursor: null,
    error: null,
    requested_by: 'admin-api',
    requested_at: new Date('2026-09-26T12:00:00Z'),
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function fakePool(): { pool: ReadPool; sql: { text: string; values: unknown[] }[] } {
  const sql: { text: string; values: unknown[] }[] = [];
  const query = <T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    sql.push({ text, values });
    if (text.includes('INSERT INTO bright_sync_runs')) {
      return Promise.resolve({ rows: [runRow({ mode: values[0] })] as T[] });
    }
    if (text.includes('WHERE id = $1')) {
      return Promise.resolve({ rows: (values[0] === RUN_ID ? [runRow()] : []) as T[] });
    }
    if (text.includes('ORDER BY requested_at DESC')) {
      return Promise.resolve({ rows: [runRow()] as T[] });
    }
    return Promise.resolve({ rows: [] as T[] });
  };
  return {
    pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    sql,
  };
}

function app(token: string | undefined = TOKEN) {
  const fake = fakePool();
  return { app: createApp({ pool: fake.pool, adminToken: () => token }), sql: fake.sql };
}

describe('POST /admin/bright/sync', () => {
  it('queues an incremental run and answers 202 with its id', async () => {
    const { app: server, sql } = app();
    const response = await request(server)
      .post('/admin/bright/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ mode: 'incremental' });

    expect(response.status).toBe(202);
    expect(response.body.runId).toBe(RUN_ID);
    expect(sql[0]?.values).toEqual(['incremental', '{}', 'admin-api']);
  });

  it('answers 401 with no token, a wrong token, or the committed placeholder', async () => {
    const { app: server, sql } = app();
    expect((await request(server).post('/admin/bright/sync').send({ mode: 'audit' })).status).toBe(
      401,
    );
    expect(
      (
        await request(server)
          .post('/admin/bright/sync')
          .set('Authorization', 'Bearer wrong')
          .send({ mode: 'audit' })
      ).status,
    ).toBe(401);
    const placeholder = app('StrongBase64Password');
    expect(
      (
        await request(placeholder.app)
          .get('/admin/bright/sync')
          .set('Authorization', 'Bearer StrongBase64Password')
      ).status,
    ).toBe(401);
    expect(sql).toHaveLength(0);
  });

  it('answers 400 on an unknown mode', async () => {
    const { app: server } = app();
    const response = await request(server)
      .post('/admin/bright/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ mode: 'everything' });
    expect(response.status).toBe(400);
  });
});

describe('GET /admin/bright/sync', () => {
  it('lists runs and shows one run by id', async () => {
    const { app: server } = app();
    const list = await request(server)
      .get('/admin/bright/sync')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(list.status).toBe(200);
    expect(list.body.runs[0].id).toBe(RUN_ID);
    expect(list.headers['cache-control']).toBe('no-store');

    const one = await request(server)
      .get(`/admin/bright/sync/${RUN_ID}`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(one.status).toBe(200);
    expect(one.body.run.requestedAt).toBe('2026-09-26T12:00:00.000Z');

    const missing = await request(server)
      .get('/admin/bright/sync/not-a-uuid')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(missing.status).toBe(404);
  });
});

describe('parseSyncRequest', () => {
  it('accepts payload statuses and an area for backfill and audit', () => {
    expect(
      parseSyncRequest({
        mode: 'backfill',
        statuses: ['ComingSoon'],
        area: { city: 'Frederick', state: 'md' },
      }),
    ).toEqual({
      ok: true,
      mode: 'backfill',
      scope: { statuses: ['ComingSoon'], area: { city: 'Frederick', state: 'MD' } },
    });
  });

  it('refuses a filter label where a payload value belongs, and an area on incremental', () => {
    expect(parseSyncRequest({ mode: 'backfill', statuses: ['Coming Soon'] }).ok).toBe(false);
    expect(parseSyncRequest({ mode: 'incremental', area: { zip: '20002' } }).ok).toBe(false);
    expect(parseSyncRequest({ mode: 'audit', extra: 1 }).ok).toBe(false);
  });
});

describe('isAuthorized', () => {
  it('matches only the exact Bearer token', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(TOKEN, TOKEN)).toBe(false);
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isAuthorized(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(isAuthorized('Bearer ', '')).toBe(false);
  });
});
