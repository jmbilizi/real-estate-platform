import type { BrightFeedTier } from '../jobs/bright-ingest/config';

/**
 * `bright_area_sync` reads and writes (#329): one row per `(area_key, feed_tier, source_status)`.
 *
 * The narrow seam `on-demand.ts` needs, so a test can pass an in-memory fake instead of opening a
 * socket — the same pattern `repository.ts`'s `ReadClient` uses.
 */
export interface AreaSyncClient {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export type AreaSyncStatus = 'complete' | 'partial' | 'failed';

export interface AreaSyncRow {
  readonly sourceStatus: string;
  readonly status: AreaSyncStatus;
  readonly sourceCount: number | null;
  readonly loadedCount: number;
  readonly resumeKey: string | null;
  readonly syncedAt: Date | null;
  readonly attemptedAt: Date;
}

interface AreaSyncDbRow {
  source_status: string;
  status: AreaSyncStatus;
  source_count: number | null;
  loaded_count: number;
  resume_key: string | null;
  synced_at: Date | null;
  attempted_at: Date;
}

function toRow(db: AreaSyncDbRow): AreaSyncRow {
  return {
    sourceStatus: db.source_status,
    status: db.status,
    sourceCount: db.source_count,
    loadedCount: db.loaded_count,
    resumeKey: db.resume_key,
    syncedAt: db.synced_at,
    attemptedAt: db.attempted_at,
  };
}

export type AreaSyncRows = ReadonlyMap<string, AreaSyncRow>;

/** Every status row on record for one area, keyed by `sourceStatus`. */
export async function getAreaSync(
  client: AreaSyncClient,
  areaKey: string,
  feedTier: BrightFeedTier,
): Promise<AreaSyncRows> {
  const { rows } = await client.query<AreaSyncDbRow>(
    'SELECT source_status, status, source_count, loaded_count, resume_key, synced_at, attempted_at ' +
      'FROM bright_area_sync WHERE area_key = $1 AND feed_tier = $2',
    [areaKey, feedTier],
  );
  return new Map(rows.map((row) => [row.source_status, toRow(row)]));
}

/**
 * Records that a status pass is starting, before the Bright request runs. Written first so a
 * concurrent request (this pod or another) reads a fresh `attempted_at` immediately, the same
 * guarantee the old in-memory `remember()` gave within one pod.
 *
 * Inserts a placeholder `partial` row on first attempt; an existing row keeps its `status`,
 * `resume_key` and counts untouched — only the attempt timestamp moves.
 */
export async function recordAreaAttempt(
  client: AreaSyncClient,
  areaKey: string,
  feedTier: BrightFeedTier,
  sourceStatus: string,
  attemptedAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO bright_area_sync (area_key, feed_tier, source_status, status, loaded_count, attempted_at)
     VALUES ($1, $2, $3, 'partial', 0, $4)
     ON CONFLICT (area_key, feed_tier, source_status) DO UPDATE
       SET attempted_at = EXCLUDED.attempted_at`,
    [areaKey, feedTier, sourceStatus, attemptedAt],
  );
}

export interface AreaSyncOutcome {
  readonly status: AreaSyncStatus;
  readonly loadedCount: number;
  readonly sourceCount: number | null;
  readonly resumeKey: string | null;
  readonly syncedAt: Date | null;
}

/** Records how a status pass finished. `attemptedAt` is written again so it never lags `syncedAt`. */
export async function recordAreaOutcome(
  client: AreaSyncClient,
  areaKey: string,
  feedTier: BrightFeedTier,
  sourceStatus: string,
  outcome: AreaSyncOutcome,
  attemptedAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO bright_area_sync
       (area_key, feed_tier, source_status, status, source_count, loaded_count, resume_key, synced_at, attempted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (area_key, feed_tier, source_status) DO UPDATE
       SET status = EXCLUDED.status,
           source_count = EXCLUDED.source_count,
           loaded_count = EXCLUDED.loaded_count,
           resume_key = EXCLUDED.resume_key,
           synced_at = EXCLUDED.synced_at,
           attempted_at = EXCLUDED.attempted_at`,
    [
      areaKey,
      feedTier,
      sourceStatus,
      outcome.status,
      outcome.sourceCount,
      outcome.loadedCount,
      outcome.resumeKey,
      outcome.syncedAt,
      attemptedAt,
    ],
  );
}

/** One `(area_key, source_status)` pair that has completed a full load at least once (#331). */
export interface TrackedArea {
  readonly areaKey: string;
  readonly sourceStatus: string;
  readonly syncedAt: Date;
}

/**
 * Every area/status the scheduled refresh (#331) may act on: rows that have reached `complete` at
 * least once, so `synced_at` is a real watermark rather than null. A `partial` or `failed` row is
 * still being populated by the on-demand loader (`on-demand.ts`) and is left to it — the refresh
 * job's bounded `ModificationTimestamp` window only makes sense on top of a completed baseline.
 */
export async function listTrackedAreas(
  client: AreaSyncClient,
  feedTier: BrightFeedTier,
): Promise<TrackedArea[]> {
  const { rows } = await client.query<{ area_key: string; source_status: string; synced_at: Date }>(
    `SELECT area_key, source_status, synced_at FROM bright_area_sync
      WHERE feed_tier = $1 AND status = 'complete' AND synced_at IS NOT NULL`,
    [feedTier],
  );
  return rows.map((row) => ({
    areaKey: row.area_key,
    sourceStatus: row.source_status,
    syncedAt: row.synced_at,
  }));
}

/**
 * Records a successful bounded refresh pass (#331): only `synced_at`/`attempted_at` move.
 *
 * Deliberately narrower than `recordAreaOutcome`: that function also rewrites `loaded_count` and
 * `resume_key`, which belong to the ORIGINAL full-area-population resume (#329) and must not be
 * touched by a delta pass on top of it — doing so would corrupt the count `recordAreaOutcome` needs
 * if that area is ever reloaded from scratch. Scoped to `status = 'complete'` so a refresh can never
 * mark an area synced while the initial load is still `partial`/`failed`.
 */
export async function recordAreaRefresh(
  client: AreaSyncClient,
  areaKey: string,
  feedTier: BrightFeedTier,
  sourceStatus: string,
  syncedAt: Date,
): Promise<void> {
  await client.query(
    `UPDATE bright_area_sync SET synced_at = $4, attempted_at = $4
      WHERE area_key = $1 AND feed_tier = $2 AND source_status = $3 AND status = 'complete'`,
    [areaKey, feedTier, sourceStatus, syncedAt],
  );
}

/** Records a thrown load as `failed`, keeping whatever counts/cursor the prior attempt left. */
export async function recordAreaFailure(
  client: AreaSyncClient,
  areaKey: string,
  feedTier: BrightFeedTier,
  sourceStatus: string,
  attemptedAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO bright_area_sync (area_key, feed_tier, source_status, status, loaded_count, attempted_at)
     VALUES ($1, $2, $3, 'failed', 0, $4)
     ON CONFLICT (area_key, feed_tier, source_status) DO UPDATE
       SET status = 'failed', attempted_at = EXCLUDED.attempted_at`,
    [areaKey, feedTier, sourceStatus, attemptedAt],
  );
}
