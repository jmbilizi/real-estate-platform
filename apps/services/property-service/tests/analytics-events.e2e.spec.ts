import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { closePool, getPool } from '../src/db/pool';
import { purgeRawAnalyticsEvents } from '../src/analytics/routes';

/**
 * Funnel events (#725) against a REAL service and REAL database: migration 059 up and down, the
 * route, the daily counts, `analytics_funnel_daily_v` and the 13-month and 30-day purges (#824).
 * The service must run with `ANALYTICS_ENABLED` unset or true.
 */
const MIGRATION = '1785801600059_create-analytics-events';
const migrationsDir = path.join(__dirname, '..', 'migrations');
const pool = () => getPool();
const http = { validateStatus: () => true };

function steps(): number {
  const names = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
  const index = names.indexOf(MIGRATION);
  if (index < 0) throw new Error(`${MIGRATION} not found`);
  return names.length - index;
}

/** Runs the node-pg-migrate CLI, like the `migrate` target. The package is ESM and Jest cannot load it. */
function migrate(direction: 'up' | 'down'): void {
  const bin = path.join(
    __dirname,
    '..',
    'node_modules',
    'node-pg-migrate',
    'bin',
    'node-pg-migrate.js',
  );
  execFileSync(process.execPath, [bin, direction, String(steps())], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
}

const tableExists = async (name: string): Promise<boolean> =>
  (await pool().query('SELECT to_regclass($1) AS t', [name])).rows[0]?.t !== null;

const session = () => randomUUID().replace(/-/g, '');
const post = (body: unknown) => axios.post('/analytics/events', body, http);

afterAll(async () => {
  await closePool();
});

describe('migration 059: analytics tables (#725)', () => {
  afterEach(() => {
    migrate('up');
  });

  it('drops the tables and the view on down, and restores them on up', async () => {
    migrate('down');
    expect(await tableExists('analytics_events')).toBe(false);
    expect(await tableExists('analytics_daily')).toBe(false);
    expect(await tableExists('analytics_funnel_daily_v')).toBe(false);
    migrate('up');
    expect(await tableExists('analytics_events')).toBe(true);
    expect(await tableExists('analytics_daily')).toBe(true);
    expect(await tableExists('analytics_funnel_daily_v')).toBe(true);
  });
});

describe('POST /analytics/events (#725)', () => {
  beforeEach(async () => {
    await pool().query('DELETE FROM analytics_events');
    await pool().query('DELETE FROM analytics_daily');
  });

  it('counts each event and reports the daily funnel', async () => {
    const sid = session();
    const plan: [string, string][] = [
      ['search', 'search'],
      ['search', 'map'],
      ['listing_view', 'detail'],
      ['listing_save', 'detail'],
      ['lead_submit', 'detail'],
    ];
    for (const [event, surface] of plan) {
      const res = await post({ event, surface, sessionId: sid });
      expect(res.status).toBe(204);
    }

    const raw = await pool().query('SELECT * FROM analytics_events');
    expect(raw.rowCount).toBe(5);
    expect(Object.keys(raw.rows[0]).sort()).toEqual([
      'anon_id',
      'app_version',
      'device',
      'event',
      'id',
      'listing_id',
      'occurred_at',
      'path_template',
      'props',
      'query_text',
      'referrer_host',
      'row_id',
      'schema_version',
      'session_id',
      'surface',
      'utm_campaign',
      'utm_medium',
      'utm_source',
    ]);

    const daily = await pool().query(
      'SELECT event, surface, count::int AS count FROM analytics_daily ORDER BY event, surface',
    );
    expect(daily.rows).toEqual([
      { event: 'lead_submit', surface: 'detail', count: 1 },
      { event: 'listing_save', surface: 'detail', count: 1 },
      { event: 'listing_view', surface: 'detail', count: 1 },
      { event: 'search', surface: 'map', count: 1 },
      { event: 'search', surface: 'search', count: 1 },
    ]);

    const funnel = await pool().query(
      `SELECT searches::int, detail_views::int, saves::int, requests::int,
              search_to_view_rate::float, view_to_request_rate::float
       FROM analytics_funnel_daily_v`,
    );
    expect(funnel.rows).toEqual([
      {
        searches: 2,
        detail_views: 1,
        saves: 1,
        requests: 1,
        search_to_view_rate: 0.5,
        view_to_request_rate: 1,
      },
    ]);
  });

  it('adds up repeat events in one daily row', async () => {
    const sid = session();
    for (let i = 0; i < 3; i += 1) {
      await post({ event: 'listing_view', surface: 'detail', sessionId: sid });
    }
    const daily = await pool().query('SELECT count::int AS count FROM analytics_daily');
    expect(daily.rows).toEqual([{ count: 3 }]);
  });

  it('rejects an unknown event, an unknown field and a bad value, and stores nothing', async () => {
    const sid = session();
    const bad = [
      { event: 'page_hover', surface: 'detail', sessionId: sid },
      { event: 'search', surface: 'detail', sessionId: sid, query: 'near a good school' },
      { event: 'search', surface: 'sidebar', sessionId: sid },
      { event: 'page_view', surface: 'home', session_id: sid, email: 'a@b.co' },
      { event: 'search', surface: 'search', sessionId: 'x' },
      { event: 'search', surface: 'search', sessionId: 'a'.repeat(65) },
      { event: 'listing_view', surface: 'detail', sessionId: sid, listingId: 'not-a-uuid' },
    ];
    for (const body of bad) {
      expect((await post(body)).status).toBe(400);
    }
    // A body over the 32 kb cap is refused before the route runs.
    const oversized = await post({
      event: 'search',
      surface: 'search',
      sessionId: 'a'.repeat(40_000),
    });
    expect(oversized.status).toBe(413);
    expect((await pool().query('SELECT 1 FROM analytics_events')).rowCount).toBe(0);
    expect((await pool().query('SELECT 1 FROM analytics_daily')).rowCount).toBe(0);
  });

  it('stores no header or IP', async () => {
    await axios.post(
      '/analytics/events',
      { event: 'search', surface: 'search', sessionId: session() },
      {
        ...http,
        headers: {
          'User-Agent': 'SecretBrowser/9',
          'X-Forwarded-For': '203.0.113.77',
          Cookie: 'sid=abc',
        },
      },
    );
    const dump = JSON.stringify(
      (await pool().query('SELECT * FROM analytics_events')).rows.concat(
        (await pool().query('SELECT * FROM analytics_daily')).rows,
      ),
    );
    for (const secret of ['SecretBrowser', '203.0.113.77', 'sid=abc']) {
      expect(dump).not.toContain(secret);
    }
  });

  it('stores a v2 event and counts it by row', async () => {
    const body = {
      event: 'feed_impression',
      surface: 'home',
      session_id: session(),
      anon_id: session(),
      row_id: 'near_you',
      position: 1,
      listing_id: randomUUID(),
      variant: 'control',
      model_version: 'v1',
      explore: false,
      utm_source: 'newsletter',
    };
    expect((await post(body)).status).toBe(204);
    const raw = await pool().query('SELECT row_id, utm_source, props FROM analytics_events');
    expect(raw.rows).toEqual([
      {
        row_id: 'near_you',
        utm_source: 'newsletter',
        props: { position: 1, variant: 'control', model_version: 'v1', explore: false },
      },
    ]);
    const daily = await pool().query('SELECT row_id, count::int AS count FROM analytics_daily');
    expect(daily.rows).toEqual([{ row_id: 'near_you', count: 1 }]);
  });

  it('purges raw rows older than 13 months and zero-result text older than 30 days, and keeps the daily counts', async () => {
    const sid = session();
    await post({ event: 'search', surface: 'search', sessionId: sid });
    await post({
      event: 'search_zero_result_text',
      surface: 'search',
      session_id: sid,
      query_text: 'castle in bethesda',
    });
    await pool().query(
      `INSERT INTO analytics_events (occurred_at, event, surface, session_id, query_text)
       VALUES (now() - interval '14 months', 'search', 'search', $1, NULL),
              (now() - interval '12 months', 'search', 'search', $1, NULL),
              (now() - interval '31 days', 'search_zero_result_text', 'search', $1, 'old text'),
              (now() - interval '29 days', 'search_zero_result_text', 'search', $1, 'newer text')`,
      [sid],
    );

    await purgeRawAnalyticsEvents(pool());

    const raw = await pool().query(
      'SELECT event, query_text FROM analytics_events ORDER BY occurred_at',
    );
    expect(raw.rows).toEqual([
      { event: 'search', query_text: null },
      { event: 'search_zero_result_text', query_text: 'newer text' },
      { event: 'search', query_text: null },
      { event: 'search_zero_result_text', query_text: 'castle in bethesda' },
    ]);
    const daily = await pool().query(
      'SELECT event, count::int AS count FROM analytics_daily ORDER BY event',
    );
    expect(daily.rows).toEqual([
      { event: 'search', count: 1 },
      { event: 'search_zero_result_text', count: 1 },
    ]);
  });
});

describe('reach aggregate, funnel and retention views (#828)', () => {
  beforeEach(async () => {
    await pool().query('DELETE FROM analytics_events');
    await pool().query('DELETE FROM analytics_daily');
    await pool().query('DELETE FROM analytics_daily_reach');
  });

  it('fills the reach table from raw rows and feeds the session funnel', async () => {
    const [a, b] = [session(), session()];
    await post([
      { event: 'listing_view', surface: 'detail', session_id: a, anon_id: a },
      { event: 'listing_view', surface: 'detail', session_id: a, anon_id: a },
      { event: 'listing_view', surface: 'detail', session_id: b, anon_id: b },
      { event: 'listing_save', surface: 'detail', session_id: a, anon_id: a },
    ]);
    const first = await pool().query<{ refreshed: boolean }>(
      'SELECT refresh_analytics_daily_reach(current_date - 1) AS refreshed',
    );
    expect(first.rows[0]?.refreshed).toBe(true);
    const reach = await pool().query(
      'SELECT event, sessions::int AS sessions, visitors::int AS visitors FROM analytics_daily_reach ORDER BY event',
    );
    expect(reach.rows).toEqual([
      { event: 'listing_save', sessions: 1, visitors: 1 },
      { event: 'listing_view', sessions: 2, visitors: 2 },
    ]);
    // A second run recounts the same days and adds nothing.
    await pool().query('SELECT refresh_analytics_daily_reach(current_date - 1)');
    const funnel = await pool().query(
      'SELECT view_sessions::int AS views, save_sessions::int AS saves, view_to_save_rate::float AS rate FROM analytics_funnel_sessions_daily_v',
    );
    expect(funnel.rows).toEqual([{ views: 2, saves: 1, rate: 0.5 }]);
  });

  it('groups visitors by first-seen week and counts D1, D7 and D30', async () => {
    const [a, b] = [session(), session()];
    const insert = (anon: string, daysAgo: number) =>
      pool().query(
        `INSERT INTO analytics_events (occurred_at, event, surface, session_id, anon_id)
         VALUES (now() - make_interval(days => $2::int), 'page_view', 'home', $1, $1)`,
        [anon, daysAgo],
      );
    // Visitor a: first seen 60 days ago, back on day 1, day 7 and day 30.
    for (const offset of [60, 59, 53, 30]) await insert(a, offset);
    // Visitor b: first seen 60 days ago, never back.
    await insert(b, 60);
    const rows = await pool().query(
      `SELECT cohort_size::int AS cohort, d1_retained::int AS d1, d7_retained::int AS d7,
              d30_retained::int AS d30, d1_rate::float AS d1_rate, d30_rate::float AS d30_rate
       FROM analytics_retention_weekly_v`,
    );
    expect(rows.rows).toEqual([{ cohort: 2, d1: 1, d7: 1, d30: 1, d1_rate: 0.5, d30_rate: 0.5 }]);
  });

  it('leaves a rate NULL while the cohort week is too young', async () => {
    const a = session();
    await pool().query(
      `INSERT INTO analytics_events (event, surface, session_id, anon_id) VALUES ('page_view', 'home', $1, $1)`,
      [a],
    );
    const rows = await pool().query(
      'SELECT cohort_size::int AS cohort, d30_rate FROM analytics_retention_weekly_v',
    );
    expect(rows.rows).toEqual([{ cohort: 1, d30_rate: null }]);
  });
});
