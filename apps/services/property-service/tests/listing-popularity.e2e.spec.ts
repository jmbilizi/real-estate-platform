import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { closePool, getPool } from '../src/db/pool';
import {
  REFRESH_LOCK_KEY,
  refreshListingPopularity as refreshOn,
} from '../src/analytics/popularity';

/**
 * `listing_popularity_14d` (#832) against a REAL database: migration 063 up and down, the counts,
 * the per-area score, the 14-day window, the column list, the refresh and the query plans.
 */
const MIGRATION = '1785801600063_create-listing-popularity-view';
const migrationsDir = path.join(__dirname, '..', 'migrations');
const pool = () => getPool();

/** The refresh needs one connection, because the advisory lock belongs to the session. */
async function refreshListingPopularity(): Promise<Awaited<ReturnType<typeof refreshOn>>> {
  const client = await pool().connect();
  try {
    return await refreshOn(client);
  } finally {
    client.release();
  }
}

function steps(): number {
  const names = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
  const index = names.indexOf(MIGRATION);
  if (index < 0) throw new Error(`${MIGRATION} not found`);
  return names.length - index;
}

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

async function insertEvents(
  listingId: string,
  event: string,
  count: number,
  ageDays = 0,
): Promise<void> {
  await pool().query(
    `INSERT INTO analytics_events (occurred_at, event, surface, listing_id, session_id)
     SELECT now() - make_interval(days => $4::int), $2, 'detail', $1, md5(random()::text)
     FROM generate_series(1, $3)`,
    [listingId, event, count, ageDays],
  );
}

const plan = async (sql: string, params: unknown[] = []): Promise<string> => {
  const { rows } = await pool().query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
  return rows.map((row: Record<string, string>) => row['QUERY PLAN']).join('\n');
};

interface Listing {
  id: string;
  area: string;
}
let listings: Listing[] = [];

beforeAll(async () => {
  const { rows } = await pool().query(
    `SELECT l.id, COALESCE(p.county_fips, p.state || ':' || left(p.zip5, 3)) AS area
     FROM listings l JOIN properties p ON p.id = l.property_id
     ORDER BY p.state, p.zip5, l.id`,
  );
  listings = rows;
  if (listings.length < 3) throw new Error('The e2e fixtures are missing');
});

beforeEach(async () => {
  await pool().query('DELETE FROM analytics_events');
});

afterAll(async () => {
  await pool().query('DELETE FROM analytics_events');
  await refreshListingPopularity();
  await closePool();
});

describe('migration 063: listing_popularity_14d (#832)', () => {
  afterEach(() => {
    migrate('up');
  });

  it('drops the view on down and restores it on up', async () => {
    const exists = async () =>
      (await pool().query("SELECT to_regclass('listing_popularity_14d') AS t")).rows[0].t !== null;
    migrate('down');
    expect(await exists()).toBe(false);
    migrate('up');
    expect(await exists()).toBe(true);
  }, 60_000);
});

describe('listing_popularity_14d (#832)', () => {
  it('counts views, saves and leads and scores against the area maximum', async () => {
    const [a] = listings as [Listing, ...Listing[]];
    const same = listings.filter((l) => l.area === a.area && l.id !== a.id);
    const b = same[0];
    await insertEvents(a.id, 'listing_view', 4);
    await insertEvents(a.id, 'listing_save', 2);
    await insertEvents(a.id, 'lead_submit', 1);
    await insertEvents(a.id, 'search', 9);
    expect(b).toBeDefined();
    if (b) await insertEvents(b.id, 'listing_view', 1);

    await refreshListingPopularity();

    const { rows } = await pool().query(
      'SELECT listing_id, views::int, saves::int, leads::int, score FROM listing_popularity_14d WHERE listing_id = ANY($1)',
      [[a.id, b?.id ?? randomUUID()]],
    );
    const top = rows.find((row) => row.listing_id === a.id);
    expect(top).toMatchObject({ views: 4, saves: 2, leads: 1, score: 1 });
    if (b) {
      const other = rows.find((row) => row.listing_id === b.id);
      expect(other.score).toBeCloseTo(Math.log(2) / Math.log(1 + 4 + 6 + 10), 10);
    }
  });

  it('ignores events older than 14 days and events with no listing', async () => {
    const [a] = listings as [Listing, ...Listing[]];
    await insertEvents(a.id, 'listing_view', 3, 15);
    await pool().query(
      "INSERT INTO analytics_events (event, surface, session_id) VALUES ('listing_view', 'detail', 'x1x1x1x1')",
    );
    await refreshListingPopularity();
    expect((await pool().query('SELECT 1 FROM listing_popularity_14d')).rowCount).toBe(0);
  });

  it('exposes no account, session, anon id or IP column', async () => {
    const { rows } = await pool().query(
      `SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = 'listing_popularity_14d'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
    );
    expect(rows.map((row) => row.attname)).toEqual([
      'listing_id',
      'area',
      'views',
      'saves',
      'leads',
      'score',
    ]);
  });
});

describe('refresh lock (#832)', () => {
  it('skips when another session holds the lock, and refreshes once it is free', async () => {
    const holder = await pool().connect();
    try {
      const taken = await holder.query('SELECT pg_try_advisory_lock($1) AS locked', [
        REFRESH_LOCK_KEY,
      ]);
      expect(taken.rows[0].locked).toBe(true);
      expect(await refreshListingPopularity()).toEqual({ refreshed: false });
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [REFRESH_LOCK_KEY]);
      holder.release();
    }
    expect(await refreshListingPopularity()).toMatchObject({ refreshed: true });
  });
});

describe('refresh and read plans (#832)', () => {
  it('refreshes in under 1 s and reads by listing id through the unique index', async () => {
    // Load: 20,000 events over every fixture listing, so the plan has work to do.
    await pool().query(
      `INSERT INTO analytics_events (occurred_at, event, surface, listing_id, session_id)
       SELECT now() - make_interval(hours => (g % 300)::int),
              (ARRAY['listing_view','listing_view','listing_view','listing_save','lead_submit'])[1 + g % 5],
              'detail', (ARRAY(SELECT id FROM listings))[1 + g % $1::int], md5(g::text)
       FROM generate_series(1, 20000) g`,
      [listings.length],
    );

    const started = Date.now();
    await refreshListingPopularity();
    const elapsed = Date.now() - started;
    console.log(`refresh ms: ${elapsed}`);
    expect(elapsed).toBeLessThan(1000);

    console.log(
      'REFRESH SOURCE PLAN\n' +
        (await plan(
          `SELECT listing_id, count(*) FROM analytics_events
           WHERE listing_id IS NOT NULL AND event IN ('listing_view','listing_save','lead_submit')
             AND occurred_at >= now() - interval '14 days' GROUP BY listing_id`,
        )),
    );

    // A small view reads by seq scan on its own. Disable it to prove the index serves the read.
    const client = await pool().connect();
    let read: string;
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query(
        'EXPLAIN (ANALYZE, BUFFERS) SELECT score FROM listing_popularity_14d WHERE listing_id = ANY($1)',
        [listings.slice(0, 3).map((l) => l.id)],
      );
      read = rows.map((row: Record<string, string>) => row['QUERY PLAN']).join('\n');
    } finally {
      client.release();
    }
    console.log(`READ PLAN\n${read}`);
    expect(read).toContain('idx_listing_popularity_14d_listing');
  });
});
