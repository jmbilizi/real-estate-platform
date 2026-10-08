/**
 * `bright_sync_runs` and `bright_sync_state` reads and writes (#338). The only module that writes
 * either table. The admin routes and the worker both go through it.
 */

export interface SyncQueryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export const SYNC_MODES = ['incremental', 'backfill', 'reconcile', 'audit', 'probe'] as const;
export type SyncMode = (typeof SYNC_MODES)[number];

export type SyncRunStatus = 'requested' | 'running' | 'succeeded' | 'failed';

export interface SyncArea {
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
}

export interface SyncScope {
  /** `StandardStatus` payload values. Absent means every status the mode covers. */
  readonly statuses?: readonly string[];
  readonly area?: SyncArea;
  /** Backfill only: skip a status whose checkpoint reads complete. The startup resume sets it. */
  readonly resume?: boolean;
}

export interface SyncRun {
  readonly id: string;
  readonly mode: SyncMode;
  readonly scope: SyncScope;
  readonly status: SyncRunStatus;
  readonly feedTier: string | null;
  readonly counts: Record<string, unknown>;
  readonly cursor: unknown;
  readonly error: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

const RUN_COLUMNS =
  'id, mode, scope, status, feed_tier, counts, cursor, error, requested_by, requested_at, ' +
  'started_at, finished_at';

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function toRun(row: Record<string, unknown>): SyncRun {
  return {
    id: String(row.id),
    mode: row.mode as SyncMode,
    scope: json<SyncScope>(row.scope, {}),
    status: row.status as SyncRunStatus,
    feedTier: (row.feed_tier as string | null) ?? null,
    counts: json<Record<string, unknown>>(row.counts, {}),
    cursor: json<unknown>(row.cursor, null),
    error: (row.error as string | null) ?? null,
    requestedBy: String(row.requested_by),
    requestedAt: iso(row.requested_at) as string,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

/** A run the admin endpoint asks for. The worker claims it on its next poll. */
export async function requestRun(
  client: SyncQueryable,
  mode: SyncMode,
  scope: SyncScope,
  requestedBy: string,
): Promise<SyncRun> {
  const { rows } = await client.query(
    `INSERT INTO bright_sync_runs (mode, scope, status, requested_by)
     VALUES ($1, $2::jsonb, 'requested', $3)
     RETURNING ${RUN_COLUMNS}`,
    [mode, JSON.stringify(scope), requestedBy],
  );
  return toRun(rows[0] as Record<string, unknown>);
}

/** A run the worker starts on its own schedule: inserted directly as `running`. */
export async function startRun(
  client: SyncQueryable,
  mode: SyncMode,
  scope: SyncScope,
  feedTier: string,
  requestedBy: string,
): Promise<SyncRun> {
  const { rows } = await client.query(
    `INSERT INTO bright_sync_runs (mode, scope, status, feed_tier, requested_by, started_at)
     VALUES ($1, $2::jsonb, 'running', $3, $4, now())
     RETURNING ${RUN_COLUMNS}`,
    [mode, JSON.stringify(scope), feedTier, requestedBy],
  );
  return toRun(rows[0] as Record<string, unknown>);
}

/** Claims the oldest requested run. `SKIP LOCKED`, so two claimers never take the same row. */
export async function claimRequestedRun(
  client: SyncQueryable,
  feedTier: string,
): Promise<SyncRun | null> {
  const { rows } = await client.query(
    `UPDATE bright_sync_runs SET status = 'running', feed_tier = $1, started_at = now()
      WHERE id = (SELECT id FROM bright_sync_runs WHERE status = 'requested'
                   ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ${RUN_COLUMNS}`,
    [feedTier],
  );
  return rows[0] === undefined ? null : toRun(rows[0]);
}

export async function recordProgress(
  client: SyncQueryable,
  runId: string,
  counts: Record<string, unknown>,
  cursor: unknown,
): Promise<void> {
  await client.query(
    'UPDATE bright_sync_runs SET counts = $2::jsonb, cursor = $3::jsonb WHERE id = $1',
    [runId, JSON.stringify(counts), JSON.stringify(cursor ?? null)],
  );
}

export async function finishRun(
  client: SyncQueryable,
  runId: string,
  outcome: { status: 'succeeded' | 'failed'; counts: Record<string, unknown>; error?: string },
): Promise<void> {
  await client.query(
    `UPDATE bright_sync_runs
        SET status = $2, counts = $3::jsonb, error = $4, finished_at = now()
      WHERE id = $1`,
    [runId, outcome.status, JSON.stringify(outcome.counts), outcome.error ?? null],
  );
}

/**
 * Marks runs a dead worker left `running` as failed. Only the lock holder calls it, so no live
 * worker owns any of them. Their checkpoints stay, so the next backfill resumes. `finished_at`
 * stays null: an interrupted run is not an attempt, so it does not delay the next scheduled run.
 */
export async function failInterruptedRuns(client: SyncQueryable): Promise<number> {
  const result = await client.query(
    `UPDATE bright_sync_runs
        SET status = 'failed', error = 'Interrupted: the worker stopped before the run finished.'
      WHERE status = 'running'`,
  );
  return result.rowCount ?? 0;
}

export async function getRun(client: SyncQueryable, runId: string): Promise<SyncRun | null> {
  const { rows } = await client.query(`SELECT ${RUN_COLUMNS} FROM bright_sync_runs WHERE id = $1`, [
    runId,
  ]);
  return rows[0] === undefined ? null : toRun(rows[0]);
}

export async function listRuns(client: SyncQueryable, limit: number): Promise<SyncRun[]> {
  const { rows } = await client.query(
    `SELECT ${RUN_COLUMNS} FROM bright_sync_runs ORDER BY requested_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toRun);
}

/**
 * The newest finished run of `mode`, succeeded or failed, or `null`. The worker schedules from
 * the last attempt, so a failing mode waits its interval instead of retrying on every poll.
 */
export async function lastFinishedRun(
  client: SyncQueryable,
  mode: SyncMode,
  feedTier: string,
): Promise<SyncRun | null> {
  const { rows } = await client.query(
    `SELECT ${RUN_COLUMNS} FROM bright_sync_runs
      WHERE mode = $1 AND feed_tier = $2 AND finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1`,
    [mode, feedTier],
  );
  return rows[0] === undefined ? null : toRun(rows[0]);
}

export async function readState<T>(
  client: SyncQueryable,
  feedTier: string,
  stream: string,
): Promise<T | null> {
  const { rows } = await client.query(
    'SELECT state FROM bright_sync_state WHERE feed_tier = $1 AND stream = $2',
    [feedTier, stream],
  );
  return rows[0] === undefined ? null : json<T>(rows[0].state, null as T);
}

export async function writeState(
  client: SyncQueryable,
  feedTier: string,
  stream: string,
  state: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO bright_sync_state (feed_tier, stream, state) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (feed_tier, stream) DO UPDATE SET state = EXCLUDED.state`,
    [feedTier, stream, JSON.stringify(state)],
  );
}

/** Session-level advisory lock key. One constant, so every worker contends for the same lock. */
export const SYNC_LOCK_KEY = 338_338_338;

export async function tryAcquireSyncLock(client: SyncQueryable): Promise<boolean> {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SYNC_LOCK_KEY]);
  return rows[0]?.locked === true;
}
