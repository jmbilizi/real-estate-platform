import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from '../listings/repository';
import { analyticsEnabled, purgeRawAnalyticsEvents } from './routes';
import type { AnalyticsSink } from './sink';

const LISTING_ID = '0190a000-0000-7000-8000-0000000000e1';
const SESSION = 'abcDEF123_-xyz789';

function createPool(): ReadPool & { recorded: { sql: string; values: unknown[] }[] } {
  const recorded: { sql: string; values: unknown[] }[] = [];
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    return Promise.resolve({ rows: [] as T[] });
  };
  return { recorded, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

const body = {
  event: 'listing_view',
  surface: 'detail',
  listingId: LISTING_ID,
  sessionId: SESSION,
};

describe('POST /analytics/events (#725)', () => {
  it('stores the event and the daily count, and nothing from the headers or the IP', async () => {
    const pool = createPool();
    const app = createApp({ pool, analyticsEnabled: () => true });
    const res = await request(app)
      .post('/analytics/events')
      .set('User-Agent', 'SecretBrowser/9')
      .set('X-Forwarded-For', '203.0.113.77')
      .set('Cookie', 'sid=abc')
      .set('Authorization', 'Bearer token-123')
      .send(body);
    expect(res.status).toBe(204);
    const writes = pool.recorded.filter((r) => /INSERT INTO analytics_/.test(r.sql));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values?.slice(0, 5)).toEqual([
      'listing_view',
      'detail',
      LISTING_ID,
      SESSION,
      2,
    ]);
    const everything = JSON.stringify(pool.recorded);
    for (const secret of ['SecretBrowser', '203.0.113.77', 'sid=abc', 'token-123']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('rejects an unknown event name', async () => {
    const pool = createPool();
    const res = await request(createApp({ pool, analyticsEnabled: () => true }))
      .post('/analytics/events')
      .send({ ...body, event: 'page_hover' });
    expect(res.status).toBe(400);
    expect(pool.recorded).toHaveLength(0);
  });

  it('rejects an unknown field and names it', async () => {
    const pool = createPool();
    const res = await request(createApp({ pool, analyticsEnabled: () => true }))
      .post('/analytics/events')
      .send({ ...body, query: 'near the good school' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('query');
    expect(pool.recorded).toHaveLength(0);
  });

  it('stores nothing when analytics is disabled', async () => {
    const pool = createPool();
    const res = await request(createApp({ pool, analyticsEnabled: () => false }))
      .post('/analytics/events')
      .send(body);
    expect(res.status).toBe(204);
    expect(pool.recorded).toHaveLength(0);
  });

  it('reads ANALYTICS_ENABLED=false as off and anything else as on', () => {
    expect(analyticsEnabled({ ANALYTICS_ENABLED: 'false' })).toBe(false);
    expect(analyticsEnabled({ ANALYTICS_ENABLED: ' FALSE ' })).toBe(false);
    expect(analyticsEnabled({})).toBe(true);
    expect(analyticsEnabled({ ANALYTICS_ENABLED: 'true' })).toBe(true);
  });
});

describe('contract v2 ingest (#824)', () => {
  const v2 = {
    event: 'feed_click',
    surface: 'home',
    session_id: SESSION,
    anon_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    utm_source: 'newsletter',
    row_id: 'near_you',
    position: 2,
    listing_id: LISTING_ID,
    variant: 'control',
    model_version: 'v1',
    explore: false,
  };

  it('stores column properties in columns and the rest in props', async () => {
    const pool = createPool();
    const res = await request(createApp({ pool, analyticsEnabled: () => true }))
      .post('/analytics/events')
      .send(v2);
    expect(res.status).toBe(204);
    const values = pool.recorded.find((r) => /INSERT INTO analytics_/.test(r.sql))?.values;
    expect(values?.[5]).toBe(v2.anon_id);
    expect(values?.[8]).toBe('newsletter');
    expect(values?.[13]).toBe('near_you');
    expect(JSON.parse(String(values?.[15]))).toEqual({
      position: 2,
      variant: 'control',
      model_version: 'v1',
      explore: false,
    });
  });

  it('stores nothing when the request carries Sec-GPC: 1', async () => {
    const pool = createPool();
    const res = await request(createApp({ pool, analyticsEnabled: () => true }))
      .post('/analytics/events')
      .set('Sec-GPC', '1')
      .send(v2);
    expect(res.status).toBe(204);
    expect(pool.recorded).toHaveLength(0);
  });

  it('stores each event of an array body and rejects the array for one bad event', async () => {
    const pool = createPool();
    const app = createApp({ pool, analyticsEnabled: () => true });
    const ok = await request(app).post('/analytics/events').send([v2, body, v2]);
    expect(ok.status).toBe(204);
    expect(pool.recorded.filter((r) => /INSERT INTO analytics_/.test(r.sql))).toHaveLength(3);
    pool.recorded.length = 0;
    const bad = await request(app)
      .post('/analytics/events')
      .send([v2, { ...v2, email: 'a@b.co' }]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('email');
    expect((await request(app).post('/analytics/events').send([])).status).toBe(400);
    expect(pool.recorded).toHaveLength(0);
  });

  it('rejects a property that belongs to another event', async () => {
    const pool = createPool();
    const res = await request(createApp({ pool, analyticsEnabled: () => true }))
      .post('/analytics/events')
      .send({ event: 'page_view', surface: 'home', session_id: SESSION, row_id: 'near_you' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('row_id');
    expect(pool.recorded).toHaveLength(0);
  });

  it('sends the event to every sink and survives a failing secondary sink', async () => {
    const seen: string[] = [];
    const primary: AnalyticsSink = {
      record: (e) => {
        seen.push(`primary:${e.event}`);
        return Promise.resolve();
      },
    };
    const secondary: AnalyticsSink = { record: () => Promise.reject(new Error('down')) };
    const app = createApp({
      pool: createPool(),
      analyticsEnabled: () => true,
      analyticsSinks: [primary, secondary],
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await request(app).post('/analytics/events').send(v2);
    error.mockRestore();
    expect(res.status).toBe(204);
    expect(seen).toEqual(['primary:feed_click']);
  });
});

describe('purgeRawAnalyticsEvents (#824)', () => {
  it('purges zero-result text after 30 days and every row after 13 months', async () => {
    const pool = createPool();
    await purgeRawAnalyticsEvents(pool);
    expect(pool.recorded).toHaveLength(2);
    expect(pool.recorded[0]?.sql).toContain("event = 'search_zero_result_text'");
    expect(pool.recorded[0]?.values[0]).toBe(30);
    expect(pool.recorded[0]?.sql).toContain('days =>');
    expect(pool.recorded[1]?.sql).toContain('months =>');
    expect(pool.recorded[1]?.values[0]).toBe(13);
  });
});
