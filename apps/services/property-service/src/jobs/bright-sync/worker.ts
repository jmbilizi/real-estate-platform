/**
 * The Bright sync worker (#338): one long-running process that replicates the feed into
 * `property_db`. It replaces the `bright-mls-ingest`, `bright-area-refresh` and
 * `bright-area-reconcile` CronJobs and the on-demand area load.
 *
 * Single-flight: a session advisory lock (`SYNC_LOCK_KEY`) is held on a dedicated connection for the
 * life of the process. A second replica waits for it. One task runs at a time, in this order of
 * precedence: an incomplete backfill, a requested run, a due incremental, a due reconcile.
 */

import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool';
import { markListingsOffMarket } from '../../db/write';
import {
  type BrightPage,
  createTokenProvider,
  type FetchLike,
  fetchPage,
  type TokenProvider,
} from '../bright-ingest/bright-client';
import { type BrightConfig, resolveBrightConfig } from '../bright-ingest/config';
import type { BrightArea } from '../bright-ingest/odata-query';
import { RateLimiter } from '../bright-ingest/rate-limiter';
import { createStagingStore, type StagedRecord } from '../bright-ingest/staging-store';
import { loadListingStatuses, mapBrightPayloads } from '../bright-map/run';
import { isSampleFeed } from '../bright-map/sample';
import type { ListingStatusLookup } from '../bright-map/status';
import { sweepOtherFeedTiers } from '../bright-map/sweep';
import { PROBE_DEFAULT_MAX_TAKEDOWN, runProbeSweep } from './probe';
import {
  claimRequestedRun,
  failInterruptedRuns,
  finishRun,
  lastFinishedRun,
  readState,
  recordProgress,
  startRun,
  type SyncMode,
  type SyncQueryable,
  type SyncRun,
  type SyncScope,
  tryAcquireSyncLock,
  writeState,
} from './store';
import { selectFingerprint } from './select';
import {
  type BackfillState,
  backfillStream,
  DEFAULT_AUDIT_AREAS,
  INCREMENTAL_STREAM,
  listingKeyOf,
  LIVE_STATUSES,
  type PageResult,
  runAudit,
  runBackfill,
  runIncremental,
  runReconcile,
  SOLD_STATUS,
  type SyncDeps,
} from './sync';

type ActiveConfig = Extract<BrightConfig, { state: 'configured' }>;

const SOURCE_SYSTEM = 'BrightMLS';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WorkerSettings {
  readonly incrementalIntervalMs: number;
  readonly overlapMs: number;
  readonly reconcileIntervalMs: number;
  /**
   * Time between probe sweeps (#715). A sweep covers every live key. About 91,000 keys is 910
   * requests of 100 keys, a few minutes at the sync's request rate. The default is daily.
   */
  readonly probeIntervalMs: number;
  /** Most keys one probe sweep takes down. Above it, the sweep takes down nothing (#715). */
  readonly probeMaxTakedown: number;
  readonly soldLookbackDays: number;
  /** `null` = unconfigured: every sold record fails closed, so the `Closed` backfill is skipped. */
  readonly soldDisplayDelayDays: number | null;
  readonly pollMs: number;
  /** Sibling Bright slices read at once (#348). Also the run's starting concurrency ceiling. */
  readonly concurrency: number;
  /** Records per slice request (`$top`). Bright streams a roughly fixed rate per request (#348), so
   * a bigger page moves more rows per request; 10,000 is the largest measured on production. */
  readonly pageSize: number;
  /** Pages applied at once, on separate pool connections (#359). The write path's own ceiling. */
  readonly applyConcurrency: number;
}

function numberFrom(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}".`);
  }
  return parsed;
}

const MAX_SYNC_PAGE_SIZE = 10_000;

function positiveIntFrom(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

export function resolveWorkerSettings(env: NodeJS.ProcessEnv = process.env): WorkerSettings {
  const delayRaw = env.BRIGHT_SOLD_DISPLAY_DELAY_DAYS;
  const pageSize = positiveIntFrom(env, 'BRIGHT_SYNC_PAGE_SIZE', 5_000);
  if (pageSize > MAX_SYNC_PAGE_SIZE) {
    throw new Error(
      `BRIGHT_SYNC_PAGE_SIZE must be ${MAX_SYNC_PAGE_SIZE} or less, got ${pageSize}.`,
    );
  }
  return {
    incrementalIntervalMs: numberFrom(env, 'BRIGHT_SYNC_INCREMENTAL_INTERVAL_MS', 5 * 60 * 1000),
    overlapMs: numberFrom(env, 'BRIGHT_SYNC_OVERLAP_MS', 2 * 60 * 1000),
    reconcileIntervalMs: numberFrom(env, 'BRIGHT_SYNC_RECONCILE_INTERVAL_MS', DAY_MS),
    probeIntervalMs: numberFrom(env, 'BRIGHT_SYNC_PROBE_INTERVAL_MS', DAY_MS),
    probeMaxTakedown: numberFrom(env, 'BRIGHT_SYNC_PROBE_MAX_TAKEDOWN', PROBE_DEFAULT_MAX_TAKEDOWN),
    soldLookbackDays: numberFrom(env, 'BRIGHT_SOLD_LOOKBACK_DAYS', 365),
    soldDisplayDelayDays:
      delayRaw === undefined || delayRaw.trim() === ''
        ? null
        : numberFrom(env, 'BRIGHT_SOLD_DISPLAY_DELAY_DAYS', 0),
    pollMs: numberFrom(env, 'BRIGHT_SYNC_POLL_MS', 10_000),
    concurrency: positiveIntFrom(env, 'BRIGHT_SYNC_CONCURRENCY', 6),
    pageSize,
    applyConcurrency: positiveIntFrom(env, 'BRIGHT_SYNC_APPLY_CONCURRENCY', 4),
  };
}

/** The statuses a full backfill covers. `Closed` only when solds can publish at all. */
export function backfillStatuses(settings: WorkerSettings): string[] {
  return settings.soldDisplayDelayDays === null
    ? [...LIVE_STATUSES]
    : [...LIVE_STATUSES, SOLD_STATUS];
}

export function soldCloseDateFrom(now: Date, lookbackDays: number): string {
  return new Date(now.getTime() - lookbackDays * DAY_MS).toISOString().slice(0, 10);
}

function toStaged(record: Record<string, unknown>): StagedRecord | null {
  try {
    const recordKey = listingKeyOf(record);
    const modified = record.ModificationTimestamp;
    const parsed = typeof modified === 'string' ? new Date(modified) : null;
    if (parsed === null || Number.isNaN(parsed.getTime())) return null;
    return { recordKey, modifiedAt: parsed.toISOString(), payload: record };
  } catch {
    return null;
  }
}

/**
 * Postgres error codes a concurrent transaction can hit through no fault of its own: two pages
 * that touch the same property or unit row can lock it in a different order (#359). Both codes
 * name a transaction Postgres itself chose to abort, never a data problem, so the fix is to redo
 * the whole transaction, not to inspect what it wrote.
 */
const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

function pgErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `work` inside `BEGIN`/`COMMIT`, retrying the whole attempt — a fresh `BEGIN`, not a resumed
 * one — when Postgres aborts it as the loser of a lock conflict with a sibling page's transaction
 * (#359). Safe because every write `work` can make is an idempotent upsert (`db/write.ts`), so
 * redoing it from scratch produces the same row, not a duplicate.
 */
async function inTransaction<T>(
  client: PoolClient,
  work: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    await client.query('BEGIN');
    try {
      const result = await work();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (attempt >= maxAttempts || !RETRYABLE_PG_CODES.has(pgErrorCode(error) ?? '')) {
        throw error;
      }
      // Exponential backoff with jitter, so two transactions retrying the same conflict do not
      // collide again on the same schedule.
      await sleep(2 ** attempt * 10 * (0.5 + Math.random()));
    }
  }
}

/** Held, live Bright listings among `listingKeys`: key to listing id. */
async function heldListingIds(
  client: SyncQueryable,
  listingKeys: readonly string[],
): Promise<Map<string, string>> {
  if (listingKeys.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT id, source_listing_key FROM listings
      WHERE source_system = $1 AND source_listing_key = ANY($2::text[]) AND deleted_at IS NULL`,
    [SOURCE_SYSTEM, listingKeys],
  );
  return new Map(rows.map((row) => [String(row.source_listing_key), String(row.id)]));
}

/** The `listing_statuses.code` values a Bright payload status resolves to. */
function codesFor(statuses: readonly ListingStatusLookup[], payloadValue: string): string[] {
  return statuses
    .filter((s) => s.resoStandardStatus === payloadValue || s.code === payloadValue)
    .map((s) => s.code);
}

export interface WorkerContext {
  readonly config: ActiveConfig;
  readonly settings: WorkerSettings;
  readonly log: (message: string) => void;
  readonly now?: () => Date;
  readonly fetchImpl?: FetchLike;
}

interface BrightSession {
  readonly tokenProvider: TokenProvider;
  readonly limiter: RateLimiter;
}

/**
 * One token provider and one rate limiter per context, shared by every run. A limiter per run
 * would reset the per-minute budget between back-to-back runs.
 */
const sessions = new WeakMap<WorkerContext, BrightSession>();

function sessionFor(ctx: WorkerContext): BrightSession {
  let session = sessions.get(ctx);
  if (session === undefined) {
    const { config, settings } = ctx;
    session = {
      tokenProvider: createTokenProvider(config.endpoint, config.credentials, {
        fetchImpl: ctx.fetchImpl,
        timeoutMs: config.replication.requestTimeoutMs,
      }),
      // `settings.concurrency` (#348), not `config.replication.maxConcurrency`: the latter is the
      // deliberately-conservative unknown-limit default shared with the gallery fetch path (see
      // `rate-limiter.ts`). Bright's own measured behaviour (see the ticket) is a roughly fixed rate
      // per request that scales close to linearly with concurrent requests, so this session's own
      // per-second/per-minute ceilings are sized to the concurrency itself rather than that default.
      limiter: new RateLimiter({
        requestsPerSecond: settings.concurrency,
        requestsPerMinute: settings.concurrency * 60,
        maxConcurrency: settings.concurrency,
      }),
    };
    sessions.set(ctx, session);
  }
  return session;
}

/** Builds the real `SyncDeps` for one run. */
function createDeps(
  ctx: WorkerContext,
  run: SyncRun,
  statuses: readonly ListingStatusLookup[],
): SyncDeps & Parameters<typeof runReconcile>[0] & Parameters<typeof runAudit>[0] {
  const pool = getPool();
  const { config, settings } = ctx;
  const now = ctx.now ?? (() => new Date());
  const { tokenProvider, limiter } = sessionFor(ctx);
  const staging = createStagingStore();
  const feed = config.feed;
  const isSample = feed === 'test';

  // Each run starts at the configured concurrency, whatever an earlier run halved it to (#348).
  limiter.resetConcurrency();

  return {
    serviceRoot: config.endpoint.serviceRoot,
    pageSize: settings.pageSize,
    concurrency: settings.concurrency,
    applyConcurrency: settings.applyConcurrency,
    now,
    log: ctx.log,
    fetchPage: (url: string): Promise<BrightPage> =>
      fetchPage(url, tokenProvider, config.endpoint.serviceRootHost, {
        ...(ctx.fetchImpl === undefined ? {} : { fetchImpl: ctx.fetchImpl }),
        limiter,
        maxRetries: config.replication.maxRetries,
        timeoutMs: config.replication.requestTimeoutMs,
        onRetry: (attempt, status) => {
          const before = limiter.concurrencyLimit;
          limiter.halveConcurrency();
          if (limiter.concurrencyLimit < before) {
            ctx.log(
              `Bright sync: HTTP ${status} (attempt ${attempt}). Concurrency ${before} -> ` +
                `${limiter.concurrencyLimit} for the rest of this run.`,
            );
          }
        },
      }),

    async applyPage(records): Promise<PageResult> {
      const staged = records
        .map((record) => toStaged(record as Record<string, unknown>))
        .filter((record): record is StagedRecord => record !== null);
      if (staged.length > 0) {
        await staging.stageRecords({
          resource: 'BrightProperties',
          feedTier: feed,
          runId: run.id,
          records: staged,
        });
      }
      const client = await pool.connect();
      try {
        return await inTransaction(client, async () => {
          const { report, rejected } = await mapBrightPayloads(
            client,
            records as Record<string, unknown>[],
            { feed, soldDisplayDelayDays: settings.soldDisplayDelayDays, statuses },
          );
          // A held listing whose current record no longer maps must not stay advertised with the
          // old data. It becomes Off market (#349): its page keeps the address and the property
          // record only. It comes back when the record maps again.
          const keyed = rejected.filter(
            (r): r is { listingKey: string; reason: string } => r.listingKey !== null,
          );
          const held = await heldListingIds(
            client,
            keyed.map((r) => r.listingKey),
          );
          let takenDown = report.takenDown;
          for (const { listingKey, reason } of keyed) {
            const id = held.get(listingKey);
            if (id !== undefined) {
              takenDown += await markListingsOffMarket(
                client,
                [id],
                `Bright sync: record now rejected (${reason})`,
              );
            }
          }
          return {
            staged: report.staged,
            mapped: report.mapped,
            published: report.published,
            withheld: report.withheld,
            takenDown,
            withheldByReason: report.withheldByReason,
            suppressedByFlag: report.suppressedByFlag,
            suppressionAnomalies: report.suppressionAnomalies,
          };
        });
      } finally {
        client.release();
      }
    },

    readState: <T>(stream: string) => readState<T>(pool, feed, stream),
    writeState: (stream, state) => writeState(pool, feed, stream, state),
    progress: (counts, cursor) => recordProgress(pool, run.id, counts, cursor),

    async listLiveLocal(payloadStatuses) {
      const codes = payloadStatuses.flatMap((status) => codesFor(statuses, status));
      const { rows } = await pool.query(
        `SELECT id, source_listing_key FROM listings
          WHERE source_system = $1 AND deleted_at IS NULL AND is_sample = $2
            AND status = ANY($3::text[])`,
        [SOURCE_SYSTEM, isSample, codes],
      );
      return new Map(rows.map((row) => [String(row.source_listing_key), String(row.id)]));
    },

    async takeDown(listingIds, reason) {
      let total = 0;
      const CHUNK = 500;
      for (let start = 0; start < listingIds.length; start += CHUNK) {
        const client = await pool.connect();
        try {
          total += await inTransaction(client, () =>
            markListingsOffMarket(client, listingIds.slice(start, start + CHUNK), reason),
          );
        } finally {
          client.release();
        }
      }
      return total;
    },

    async countLocal(area: BrightArea | undefined, status: string) {
      const clauses = [
        'source_system = $1',
        'deleted_at IS NULL',
        'is_sample = $2',
        'status = ANY($3::text[])',
      ];
      const params: unknown[] = [SOURCE_SYSTEM, isSample, codesFor(statuses, status)];
      if (area?.city !== undefined) {
        params.push(area.city);
        clauses.push(`lower(city) = lower($${params.length})`);
      }
      if (area?.state !== undefined) {
        params.push(area.state);
        clauses.push(`state = upper($${params.length})`);
      }
      if (area?.zip !== undefined) {
        params.push(area.zip);
        clauses.push(`zip5 = $${params.length}`);
      }
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM listings WHERE ${clauses.join(' AND ')}`,
        params,
      );
      return Number(rows[0]?.n ?? 0);
    },
  };
}

/**
 * `, N Bright request(s) (R.R/min)` when the run counted requests, else `''`.
 *
 * The contractual rate ceiling is unknown (#33), so this is how a run's actual pace against Bright
 * gets read back, from the CronJob's own log, without a dashboard.
 */
function requestRateLog(counts: Record<string, unknown>, durationMs: number): string {
  const requests = counts.brightRequests;
  if (typeof requests !== 'number') return '';
  const perMinute = durationMs > 0 ? Math.round((requests / durationMs) * 60_000 * 10) / 10 : 0;
  return ` ${requests} Bright request(s), ${perMinute}/min.`;
}

/** Runs one claimed or scheduled run to its end and records the outcome. Never throws. */
export async function executeRun(ctx: WorkerContext, run: SyncRun): Promise<boolean> {
  const pool = getPool();
  const now = ctx.now ?? (() => new Date());
  const started = Date.now();
  try {
    const statuses = await loadListingStatuses(pool);
    const deps = createDeps(ctx, run, statuses);
    const scope = run.scope;
    let counts: Record<string, unknown>;

    switch (run.mode) {
      case 'backfill': {
        const targets = scope.statuses ?? backfillStatuses(ctx.settings);
        if (scope.area === undefined) {
          // The first incremental after a backfill covers every change made while it ran.
          if ((await deps.readState(INCREMENTAL_STREAM)) === null) {
            await deps.writeState(INCREMENTAL_STREAM, { watermark: now().toISOString() });
          }
        }
        counts = await runBackfill(deps, {
          statuses: targets,
          ...(scope.area === undefined ? {} : { area: scope.area }),
          resume: scope.resume === true,
          soldCloseDateFrom: soldCloseDateFrom(now(), ctx.settings.soldLookbackDays),
        });
        break;
      }
      case 'incremental':
        counts = await runIncremental(deps, { overlapMs: ctx.settings.overlapMs });
        break;
      case 'reconcile':
        counts = await runReconcile(deps, { statuses: scope.statuses ?? LIVE_STATUSES });
        break;
      case 'probe':
        counts = await runProbeSweep(
          {
            serviceRoot: deps.serviceRoot,
            fetchPage: deps.fetchPage,
            listLive: () =>
              deps.listLiveLocal(
                statuses
                  .filter((s) => s.isPubliclySearchable && !s.isTerminal)
                  .flatMap((s) => (s.resoStandardStatus === null ? [] : [s.resoStandardStatus])),
              ),
            takeDown: deps.takeDown,
            statuses,
            concurrency: ctx.settings.concurrency,
            log: ctx.log,
          },
          { maxTakedown: ctx.settings.probeMaxTakedown },
        );
        break;
      case 'audit':
        counts = await runAudit(deps, {
          areas:
            scope.area === undefined
              ? DEFAULT_AUDIT_AREAS
              : [{ label: JSON.stringify(scope.area), area: scope.area }],
          statuses: scope.statuses ?? LIVE_STATUSES,
        });
        break;
    }
    const durationMs = Date.now() - started;
    counts = { ...counts, durationMs };
    await finishRun(pool, run.id, { status: 'succeeded', counts });
    ctx.log(
      `Bright sync ${run.mode} ${run.id} succeeded in ${durationMs} ms.` +
        requestRateLog(counts, durationMs),
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(pool, run.id, {
      status: 'failed',
      counts: { durationMs: Date.now() - started },
      error: message,
    }).catch(() => undefined);
    ctx.log(`Bright sync ${run.mode} ${run.id} failed: ${message}`);
    return false;
  }
}

/** True when some full-backfill status has no checkpoint or an incomplete one. */
export async function backfillIncomplete(
  client: SyncQueryable,
  feed: string,
  statuses: readonly string[],
): Promise<boolean> {
  for (const status of statuses) {
    const state = await readState<BackfillState>(client, feed, backfillStream(status));
    if (state === null || !state.complete) return true;
  }
  return false;
}

/** True when the tier holds a live Bright listing. A cheap existence check, not `count(*)`. */
async function hasLiveListings(client: SyncQueryable, isSample: boolean): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM listings
        WHERE source_system = $1 AND deleted_at IS NULL AND is_sample = $2
     ) AS present`,
    [SOURCE_SYSTEM, isSample],
  );
  return rows[0]?.present === true;
}

/**
 * Resets the full-backfill checkpoints when the tier holds no live listings (2026-09-27 ruling: a
 * deploy or restart must never re-run a full backfill on its own). A purge or a restore can empty
 * the tier while a checkpoint still reads complete, so the checkpoint alone is not proof the data
 * is there. An incomplete checkpoint already resumes on its own and is left untouched.
 */
export async function resetBackfillIfEmpty(
  pool: WorkerPool,
  feed: string,
  isSample: boolean,
  statuses: readonly string[],
  log: (message: string) => void,
): Promise<void> {
  if (await hasLiveListings(pool, isSample)) return;
  for (const status of statuses) {
    await writeState(pool, feed, backfillStream(status), {
      through: null,
      complete: false,
    } satisfies BackfillState);
  }
  log(
    `Bright sync: feed tier ${feed} has no live listings. Reset ${statuses.length} backfill ` +
      'checkpoint(s) for a full backfill.',
  );
}

/** The state stream that holds the `$select` fingerprint of the last backfill plan. */
export const SELECT_FINGERPRINT_STREAM = 'select-fingerprint';

/**
 * A change to `BRIGHT_SYNC_SELECT` adds a field that rows written earlier lack (#722: `office_key`).
 * When the stored fingerprint differs, reset the backfill checkpoints. The backfill resume then
 * rewrites every listing on its own, with no manual step. The fingerprint is stored after the reset,
 * so a restart mid-backfill leaves the checkpoints to resume, and a repeat start is a no-op. This
 * is the one case where a deploy starts a full backfill (the 2026-09-27 ruling covers restarts).
 */
export async function resetBackfillOnSelectChange(
  pool: WorkerPool,
  feed: string,
  statuses: readonly string[],
  log: (message: string) => void,
): Promise<void> {
  const current = selectFingerprint();
  const stored = await readState<{ fingerprint?: string }>(pool, feed, SELECT_FINGERPRINT_STREAM);
  if (stored?.fingerprint === current) return;
  for (const status of statuses) {
    await writeState(pool, feed, backfillStream(status), {
      through: null,
      complete: false,
    } satisfies BackfillState);
  }
  await writeState(pool, feed, SELECT_FINGERPRINT_STREAM, { fingerprint: current });
  log(
    `Bright sync: the field list changed (${stored?.fingerprint ?? 'none'} to ${current}). ` +
      `Reset ${statuses.length} backfill checkpoint(s) for a full backfill.`,
  );
}

/** Starts and runs a worker-scheduled run. Returns whether it succeeded. */
async function scheduled(
  ctx: WorkerContext,
  mode: SyncMode,
  scope: SyncScope,
  requestedBy: string,
): Promise<boolean> {
  const run = await startRun(getPool(), mode, scope, ctx.config.feed, requestedBy);
  return executeRun(ctx, run);
}

/** Wait after a failed backfill before the resume tries again. */
const BACKFILL_RETRY_MS = 60_000;

/**
 * Waits until Postgres answers and the property-service `migrate` initContainer has created the
 * sync tables. The worker starts in parallel with both on a cold deploy. Retries at the application
 * level, as account-service does, rather than ordering pods in the manifests.
 */
export async function waitForSchema(
  client: SyncQueryable,
  log: (message: string) => void,
  options: { readonly attempts?: number; readonly delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 120;
  const delayMs = options.delayMs ?? 5_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { rows } = await client.query(
        "SELECT to_regclass('public.bright_sync_state') IS NOT NULL AS ready",
      );
      if (rows[0]?.ready === true) return;
      log(`Bright sync: waiting for migrations (attempt ${attempt}).`);
    } catch (error) {
      log(
        `Bright sync: waiting for Postgres (attempt ${attempt}): ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
    if (attempt >= attempts) {
      throw new Error(`Postgres or the sync tables were not ready after ${attempts} attempts.`);
    }
    await sleep(delayMs);
  }
}

/** A pool-shaped seam: plain queries plus a dedicated connection for a transaction. */
export interface WorkerPool extends SyncQueryable {
  connect(): Promise<SyncQueryable & { release: () => void }>;
}

/**
 * Startup, after the lock and before any backfill: fail the runs a dead worker left `running`,
 * sweep the other feed tier (#314), then reset the backfill checkpoints if this tier is empty
 * (2026-09-27 ruling). A switch from the test tier to production drops every test-feed listing
 * (`is_sample`) before production rows arrive.
 */
export async function prepareWorker(
  pool: WorkerPool,
  feed: ActiveConfig['feed'],
  settings: WorkerSettings,
  log: (message: string) => void,
): Promise<void> {
  const interrupted = await failInterruptedRuns(pool);
  if (interrupted > 0) log(`Bright sync: marked ${interrupted} interrupted run(s) failed.`);

  const client = await pool.connect();
  try {
    const sweep = await sweepOtherFeedTiers(client, feed);
    if (sweep.swept) {
      log(
        `Bright sync: swept tier(s) ${sweep.otherTiers.join(', ')}: ` +
          `${sweep.sampleListingsDeleted} sample listing(s), ${sweep.stagingRowsDeleted} staged row(s).`,
      );
    }
  } finally {
    client.release();
  }

  await resetBackfillIfEmpty(pool, feed, isSampleFeed(feed), backfillStatuses(settings), log);
  await resetBackfillOnSelectChange(pool, feed, backfillStatuses(settings), log);
}

/**
 * The worker loop. Returns only when `shouldStop()` turns true. The lock connection is held for
 * the whole life of the loop, and its loss ends the process through the pool error handler.
 */
export async function runWorker(
  ctx: WorkerContext,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const pool = getPool();
  const lockClient = await pool.connect();
  lockClient.on('error', (error) => {
    ctx.log(`Bright sync lock connection lost: ${error.message}. Exiting.`);
    process.exit(1);
  });
  while (!(await tryAcquireSyncLock(lockClient))) {
    ctx.log('Bright sync: another worker holds the lock. Waiting.');
    await sleep(30_000);
    if (shouldStop()) return;
  }
  ctx.log(`Bright sync worker holds the lock. Feed tier: ${ctx.config.feed}.`);

  await prepareWorker(pool, ctx.config.feed, ctx.settings, ctx.log);

  const settings = ctx.settings;
  const fullStatuses = backfillStatuses(settings);

  // A backfill that keeps failing must not starve the other tasks: between retries, requested
  // runs and the incremental still run.
  let nextBackfillAt = 0;
  while (!shouldStop()) {
    if (
      Date.now() >= nextBackfillAt &&
      (await backfillIncomplete(pool, ctx.config.feed, fullStatuses))
    ) {
      if (await scheduled(ctx, 'backfill', { resume: true }, 'worker:backfill-resume')) {
        await scheduled(ctx, 'audit', {}, 'worker:after-backfill');
      } else {
        nextBackfillAt = Date.now() + BACKFILL_RETRY_MS;
      }
      continue;
    }

    const requested = await claimRequestedRun(pool, ctx.config.feed);
    if (requested !== null) {
      await executeRun(ctx, requested);
      continue;
    }

    const nowMs = (ctx.now ?? (() => new Date()))().getTime();
    const lastIncremental = await lastFinishedRun(pool, 'incremental', ctx.config.feed);
    if (
      lastIncremental === null ||
      nowMs - Date.parse(lastIncremental.finishedAt as string) >= settings.incrementalIntervalMs
    ) {
      await scheduled(ctx, 'incremental', {}, 'worker:schedule');
      continue;
    }

    const lastReconcile = await lastFinishedRun(pool, 'reconcile', ctx.config.feed);
    if (
      lastReconcile === null ||
      nowMs - Date.parse(lastReconcile.finishedAt as string) >= settings.reconcileIntervalMs
    ) {
      await scheduled(ctx, 'reconcile', {}, 'worker:schedule');
      await scheduled(ctx, 'audit', {}, 'worker:schedule');
      continue;
    }

    const lastProbe = await lastFinishedRun(pool, 'probe', ctx.config.feed);
    if (
      lastProbe === null ||
      nowMs - Date.parse(lastProbe.finishedAt as string) >= settings.probeIntervalMs
    ) {
      await scheduled(ctx, 'probe', {}, 'worker:schedule');
      continue;
    }

    await sleep(settings.pollMs);
  }
  lockClient.release();
}

/** Resolves the Bright config, or `null` with the reason logged when it is not usable. */
export function resolveActiveConfig(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): ActiveConfig | null {
  const config = resolveBrightConfig(env);
  if (config.state !== 'configured') {
    log(`Bright sync: credentials not configured (${config.missing.join(', ')}). Idle.`);
    return null;
  }
  return config;
}
