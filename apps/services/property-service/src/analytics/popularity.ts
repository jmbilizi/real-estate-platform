import type { ReadClient } from '../listings/repository';

/** #832. Refreshes `listing_popularity_14d` every hour. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** CONCURRENTLY keeps the view readable during the refresh. Two pods queue on the view lock. */
export async function refreshListingPopularity(db: ReadClient): Promise<void> {
  await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY listing_popularity_14d');
}

let timerStarted = false;

/** Pass the listing-read pool: the analytics pool stops a statement after 1 s. */
export function startPopularityRefreshTimer(db: ReadClient): void {
  if (timerStarted) return;
  timerStarted = true;
  const run = (): void => {
    refreshListingPopularity(db).catch((error: unknown) => {
      console.error('Listing popularity refresh failed:', error);
    });
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, REFRESH_INTERVAL_MS).unref();
}
