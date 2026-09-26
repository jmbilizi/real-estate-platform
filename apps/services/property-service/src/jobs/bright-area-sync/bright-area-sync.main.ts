/**
 * Program entry for the scheduled per-area refresh and daily key reconciliation (#331):
 * `node bright-area-sync.js refresh` or `node bright-area-sync.js reconcile`.
 *
 * One bundled entry with two modes, dispatched by the first CLI argument, rather than two entries:
 * both modes read `bright_area_sync` and share the same Bright/DB wiring, and the `bright-mls-ingest`
 * CronJob's own `bright-ingest`/`bright-audit` split already shows the cost of a second entry per
 * mode (one more `additionalEntryPoints` block, one more Dockerfile-reachable bundle). Two CronJob
 * resources point at this one image entry with different `command` arguments and their own
 * schedules (`infra/k8s/base/cronjobs/bright-area-refresh.cronjob.yaml`,
 * `bright-area-reconcile.cronjob.yaml`).
 *
 * Exit codes follow `bright-ingest.main.ts`'s convention: `not_configured` and a completed run are
 * both **0**; an unusable configuration or a mode that throws is **1**, bounded by the CronJob's
 * `backoffLimit` rather than a crash loop.
 */

import { randomUUID } from 'node:crypto';

import { closePool, getPool } from '../../db/pool';
import { softDeleteListings } from '../../db/write';
import {
  listTrackedAreas,
  recordAreaRefresh,
  type TrackedArea,
} from '../../listings/area-coverage-store';
import { listBrightListingIdentities } from '../../listings/repository';
import { parseAreaKey } from '../../listings/on-demand';

import { createTokenProvider } from '../bright-ingest/bright-client';
import { resolveBrightConfig } from '../bright-ingest/config';
import { fetchAreaListings } from '../bright-ingest/area-fetch';
import { createStagingStore } from '../bright-ingest/staging-store';

import { loadListingStatuses, mapStagedBrightProperties } from '../bright-map/run';

import { type RefreshDeps, runAreaRefresh } from './run-refresh';
import { type ReconcileDeps, runAreaReconcile } from './run-reconcile';

function resolveSoldDisplayDelayDays(env: NodeJS.ProcessEnv): number | null {
  const raw = env.BRIGHT_SOLD_DISPLAY_DELAY_DAYS;
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function runRefreshMode(): Promise<void> {
  const env = process.env;
  const config = resolveBrightConfig(env);
  if (config.state !== 'configured') {
    console.info(
      JSON.stringify({
        job: 'bright-area-refresh',
        event: 'not_configured',
        message: `Bright MLS credentials are not configured: ${config.missing.join(', ')}.`,
      }),
    );
    return;
  }

  const pool = getPool();
  const tokenProvider = createTokenProvider(config.endpoint, config.credentials);
  const store = createStagingStore();
  const pageSize = config.replication.pageSize ?? 200;
  const maxRecordsPerWindow = positiveInt(env, 'BRIGHT_AREA_REFRESH_MAX_RECORDS', 500);
  // Read once for the whole run, not once per due window: listing_statuses is a small, static
  // vocabulary table, and a run with the default 25-area cap would otherwise issue 25 identical
  // reads for it.
  const statusesPromise = loadListingStatuses(pool);

  const deps: RefreshDeps = {
    listTracked: (): Promise<TrackedArea[]> => listTrackedAreas(pool, config.feed),
    parseArea: parseAreaKey,
    fetchWindow: async ({ area, sourceStatus, modifiedAfter, modifiedUntil }) => {
      const result = await fetchAreaListings({
        serviceRoot: config.endpoint.serviceRoot,
        serviceRootHost: config.endpoint.serviceRootHost,
        tokenProvider,
        store,
        runId: randomUUID(),
        feedTier: config.feed,
        ...area,
        status: sourceStatus,
        afterKey: null,
        pageSize,
        maxRecords: maxRecordsPerWindow,
        modifiedAfter,
        modifiedUntil,
        pageOptions: { timeoutMs: config.replication.requestTimeoutMs, maxRetries: 1 },
      });
      return { listingKeys: result.listingKeys, complete: result.complete };
    },
    mapRecords: async (listingKeys) => {
      const mapping = await mapStagedBrightProperties(pool, {
        feed: config.feed,
        soldDisplayDelayDays: resolveSoldDisplayDelayDays(env),
        listingKeys: [...listingKeys],
        statuses: await statusesPromise,
      });
      return { published: mapping.published };
    },
    recordSuccess: (areaKey, sourceStatus, syncedAt) =>
      recordAreaRefresh(pool, areaKey, config.feed, sourceStatus, syncedAt),
    log: (message) => console.info(JSON.stringify({ job: 'bright-area-refresh', message })),
    now: () => Date.now(),
  };

  const report = await runAreaRefresh(deps, {
    intervalMs: positiveInt(env, 'BRIGHT_AREA_REFRESH_INTERVAL_MS', 6 * 60 * 60 * 1000),
    overlapMs: positiveInt(env, 'BRIGHT_AREA_REFRESH_OVERLAP_MS', 5 * 60 * 1000),
    maxAreasPerRun: positiveInt(env, 'BRIGHT_AREA_REFRESH_MAX_AREAS_PER_RUN', 25),
  });
  console.info(JSON.stringify({ job: 'bright-area-refresh', event: 'run_finished', ...report }));
}

async function runReconcileMode(): Promise<void> {
  const env = process.env;
  const config = resolveBrightConfig(env);
  if (config.state !== 'configured') {
    console.info(
      JSON.stringify({
        job: 'bright-area-reconcile',
        event: 'not_configured',
        message: `Bright MLS credentials are not configured: ${config.missing.join(', ')}.`,
      }),
    );
    return;
  }

  const pool = getPool();
  const tokenProvider = createTokenProvider(config.endpoint, config.credentials);
  const store = createStagingStore();
  const pageSize = config.replication.pageSize ?? 200;
  const maxRecordsPerStatus = positiveInt(env, 'BRIGHT_AREA_RECONCILE_MAX_RECORDS', 20_000);

  const statuses = await loadListingStatuses(pool);
  const wireToCode = new Map<string, string>();
  for (const status of statuses) {
    if (status.resoStandardStatus !== null && !wireToCode.has(status.resoStandardStatus)) {
      wireToCode.set(status.resoStandardStatus, status.code);
    }
  }

  const deps: ReconcileDeps = {
    listTracked: (): Promise<TrackedArea[]> => listTrackedAreas(pool, config.feed),
    parseArea: parseAreaKey,
    fetchLiveKeys: async ({ area, sourceStatus }) => {
      const result = await fetchAreaListings({
        serviceRoot: config.endpoint.serviceRoot,
        serviceRootHost: config.endpoint.serviceRootHost,
        tokenProvider,
        store,
        runId: randomUUID(),
        feedTier: config.feed,
        ...area,
        status: sourceStatus,
        afterKey: null,
        pageSize,
        maxRecords: maxRecordsPerStatus,
        pageOptions: { timeoutMs: config.replication.requestTimeoutMs, maxRetries: 1 },
      });
      return { listingKeys: result.listingKeys, complete: result.complete };
    },
    wireToLocalCode: (wireStatus) => wireToCode.get(wireStatus) ?? null,
    listLocal: ({ area, statusCodes }) =>
      listBrightListingIdentities(pool, { ...area, statusCodes }),
    // The UPDATE and its per-row listing_events INSERT must commit together (see
    // softDeleteListings' doc comment), so this opens its own connection and wraps both in one
    // transaction — the pool itself cannot: each `pool.query()` call may land on a different
    // connection.
    softDelete: async (listingIds, reason) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const deleted = await softDeleteListings(client, listingIds, reason);
        await client.query('COMMIT');
        return deleted;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    log: (message) => console.info(JSON.stringify({ job: 'bright-area-reconcile', message })),
    now: () => Date.now(),
  };

  const report = await runAreaReconcile(deps);
  console.info(JSON.stringify({ job: 'bright-area-reconcile', event: 'run_finished', ...report }));
}

const mode = process.argv[2];

(mode === 'refresh'
  ? runRefreshMode()
  : mode === 'reconcile'
    ? runReconcileMode()
    : Promise.reject(
        new Error(
          `bright-area-sync.js requires a mode argument: "refresh" or "reconcile", got "${mode}".`,
        ),
      )
)
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        job: 'bright-area-sync',
        mode,
        event: 'run_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => closePool())
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        job: 'bright-area-sync',
        event: 'pool_close_failed',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
