import { Pool } from 'pg';
import type { ReadClient } from '../listings/repository';

/**
 * #828. Fills `analytics_daily_reach` (distinct sessions and visitors per day and event) from the
 * raw rows. The SQL function takes a transaction lock, so one pod refreshes and the others skip.
 * It recounts only the last days. Older days keep their rows after the purge deletes the raw rows.
 */
export const REACH_REFRESH_DAYS = 3;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REFRESH_STATEMENT_TIMEOUT_MS = 60_000;
const MAX_START_JITTER_MS = 5 * 60 * 1000;

export async function refreshAnalyticsReach(db: ReadClient): Promise<boolean> {
  const { rows } = await db.query<{ refreshed: boolean }>(
    "SELECT refresh_analytics_daily_reach((now() AT TIME ZONE 'UTC')::date - $1::int) AS refreshed",
    [REACH_REFRESH_DAYS],
  );
  return rows[0]?.refreshed === true;
}

let timerStarted = false;
let refreshPool: Pool | null = null;

function getRefreshPool(): Pool {
  if (refreshPool) return refreshPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  refreshPool = new Pool({
    connectionString,
    max: 1,
    statement_timeout: REFRESH_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
  });
  refreshPool.on('error', (error) => {
    console.error('Analytics reach pool error:', error);
  });
  return refreshPool;
}

export function startReachRefreshTimer(): void {
  if (timerStarted) return;
  timerStarted = true;
  const run = (): void => {
    refreshAnalyticsReach(getRefreshPool()).catch((error: unknown) => {
      console.error('Analytics reach refresh failed:', error);
    });
  };
  setTimeout(run, 90_000 + Math.floor(Math.random() * MAX_START_JITTER_MS)).unref();
  setInterval(run, REFRESH_INTERVAL_MS).unref();
}
