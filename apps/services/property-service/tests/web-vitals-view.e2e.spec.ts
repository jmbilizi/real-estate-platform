import { randomUUID } from 'node:crypto';
import { closePool, getPool } from '../src/db/pool';

/**
 * `analytics_web_vitals_p75_*_v` (#987) against a REAL database with migration 069 applied: the
 * p75 per route and device class, the 28-day window and the rows the view must skip.
 */
const pool = () => getPool();
const ROUTE = '/listing/[id]';

async function insertVital(
  metric: string,
  value: number,
  options: { route?: string; device?: string; surface?: string; daysAgo?: number } = {},
): Promise<void> {
  const { route = ROUTE, device = 'mobile', surface = 'detail', daysAgo = 0 } = options;
  await pool().query(
    `INSERT INTO analytics_events (occurred_at, event, surface, session_id, path_template, device, props)
     VALUES (now() - make_interval(days => $6::int), 'web_vital', $1, $2, $3, $4, jsonb_build_object('metric', $5::text, 'value', $7::numeric, 'rating', 'good'))`,
    [surface, randomUUID().replace(/-/g, ''), route, device, metric, daysAgo, value],
  );
}

beforeEach(async () => {
  await pool().query("DELETE FROM analytics_events WHERE event = 'web_vital'");
});
afterAll(async () => {
  await pool().query("DELETE FROM analytics_events WHERE event = 'web_vital'");
  await closePool();
});

describe('web vitals p75 views (#987)', () => {
  it('gives p75 LCP per route and device class', async () => {
    // Mobile values 1000..4000 step 1000: p75 = 3250 (linear interpolation).
    for (const v of [1000, 2000, 3000, 4000]) await insertVital('LCP', v);
    await insertVital('LCP', 900, { device: 'desktop' });
    await insertVital('LCP', 5000, { route: '/[city]/[...rest]', surface: 'search' });
    const { rows } = await pool().query(
      `SELECT path_template, device, samples::int AS samples, p75::float AS p75
       FROM analytics_web_vitals_p75_28d_v WHERE metric = 'LCP' ORDER BY path_template, device`,
    );
    expect(rows).toEqual([
      { path_template: '/[city]/[...rest]', device: 'mobile', samples: 1, p75: 5000 },
      { path_template: ROUTE, device: 'desktop', samples: 1, p75: 900 },
      { path_template: ROUTE, device: 'mobile', samples: 4, p75: 3250 },
    ]);
  });

  it('keeps CLS decimals and separates the metrics', async () => {
    for (const v of [0.05, 0.1]) await insertVital('CLS', v);
    await insertVital('INP', 200);
    const { rows } = await pool().query(
      'SELECT metric, p75::float AS p75 FROM analytics_web_vitals_p75_28d_v ORDER BY metric',
    );
    expect(rows).toEqual([
      { metric: 'CLS', p75: 0.0875 },
      { metric: 'INP', p75: 200 },
    ]);
  });

  it('groups the daily view by UTC day and drops old rows from the 28-day view', async () => {
    await insertVital('LCP', 1000);
    await insertVital('LCP', 9000, { daysAgo: 40 });
    const daily = await pool().query(
      'SELECT count(DISTINCT day)::int AS days FROM analytics_web_vitals_p75_daily_v',
    );
    expect(daily.rows[0]).toEqual({ days: 2 });
    const window = await pool().query(
      'SELECT samples::int AS samples, p75::float AS p75 FROM analytics_web_vitals_p75_28d_v',
    );
    expect(window.rows).toEqual([{ samples: 1, p75: 1000 }]);
  });

  it('ignores other events and rows with no route or device', async () => {
    await pool().query(
      "INSERT INTO analytics_events (event, surface, session_id, path_template, device, props) VALUES ('page_view', 'detail', 'abcdefgh1', $1, 'mobile', '{\"metric\":\"LCP\",\"value\":1}')",
      [ROUTE],
    );
    await pool().query(
      "INSERT INTO analytics_events (event, surface, session_id, props) VALUES ('web_vital', 'detail', 'abcdefgh2', '{\"metric\":\"LCP\",\"value\":1}')",
    );
    const { rows } = await pool().query('SELECT * FROM analytics_web_vitals_p75_28d_v');
    expect(rows).toEqual([]);
  });
});
