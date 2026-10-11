import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from '../listings/repository';
import { analyticsEnabled } from './routes';

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
    expect(writes[0]?.values).toEqual(['listing_view', 'detail', LISTING_ID, SESSION]);
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
