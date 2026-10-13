import { Pool } from 'pg';
import type { ReadClient } from '../listings/repository';

/** #832. Refreshes `listing_popularity_14d` every hour. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_STATEMENT_TIMEOUT_MS = 60_000;
/** Spreads the first run over 0 to 5 minutes, so pods that start together do not refresh together. */
const MAX_START_JITTER_MS = 5 * 60 * 1000;
/** Arbitrary constant that names this refresh in `pg_try_advisory_lock`. */
export const REFRESH_LOCK_KEY = 832_014;

export type RefreshResult = { refreshed: true; ms: number } | { refreshed: false };

/**
 * Takes a session lock, so one pod refreshes and the others skip at once. `db` must be one
 * connection: the lock belongs to the session that took it.
 */
export async function refreshListingPopularity(db: ReadClient): Promise<RefreshResult> {
  const lock = await db.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
    REFRESH_LOCK_KEY,
  ]);
  if (!lock.rows[0]?.locked) return { refreshed: false };
  const started = Date.now();
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY listing_popularity_14d');
    return { refreshed: true, ms: Date.now() - started };
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [REFRESH_LOCK_KEY]);
  }
}

/** One connection, its own statement timeout. A refresh never takes a connection from the read pool. */
function createRefreshPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const pool = new Pool({
    connectionString,
    max: 1,
    statement_timeout: REFRESH_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
  });
  pool.on('error', (error) => {
    console.error('Popularity refresh pool error:', error);
  });
  return pool;
}

let timerStarted = false;
let refreshPool: Pool | null = null;

async function runOnce(): Promise<void> {
  refreshPool ??= createRefreshPool();
  const client = await refreshPool.connect();
  try {
    const result = await refreshListingPopularity(client);
    if (result.refreshed) {
      console.info(`Listing popularity refreshed in ${result.ms} ms`);
    } else {
      console.debug('Listing popularity refresh skipped: another pod holds the lock');
    }
  } finally {
    client.release();
  }
}

export function startPopularityRefreshTimer(): void {
  if (timerStarted) return;
  timerStarted = true;
  const run = (): void => {
    runOnce().catch((error: unknown) => {
      console.error('Listing popularity refresh failed:', error);
    });
  };
  setTimeout(run, 60_000 + Math.floor(Math.random() * MAX_START_JITTER_MS)).unref();
  setInterval(run, REFRESH_INTERVAL_MS).unref();
}
