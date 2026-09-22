/**
 * The Bright MLS ingestion run — the decision half.
 *
 * `bright-ingest.main.ts` is the program that invokes this; the split mirrors
 * `seed-on-start.ts` / `seed-on-start.main.ts` and exists for the same reason: a bundled entry point
 * cannot hold logic that anything wants to unit-test, because `require.main === module` is silently
 * always false inside a webpack bundle.
 *
 * ## What a run does
 *
 * Resolves configuration, and then either:
 *
 *  - reports `not_configured` and finishes **successfully** — the expected state for any
 *    environment that is not wired yet, which now means one where #117 has not provisioned a
 *    secret, since #176 wired every overlay's endpoint pair; or
 *  - authenticates, probes `$metadata`, and replicates every configured resource into the staging
 *    tables, reporting `replicated`.
 *
 * `$metadata` is still probed first, one request per run. It is the drift detector: the `sha256` on
 * the run record is comparable with the one recorded beside the committed document in
 * `docs/bright-mls/README.md`, so a schema change at Bright arrives as a changed hash rather than as
 * a wrong-looking field weeks later.
 *
 * ## Staging only. The consumer tables stay off-limits
 *
 * Records land in `bright_staging_records` and nowhere else. Mapping into
 * `properties`/`units`/`listings` is #93, and `src/db/write.ts` remains the only module that writes
 * `listings`. `no-consumer-writes.spec.ts` asserts that structurally: it allows the staging tables
 * by name and nothing else.
 *
 * ## Why "not configured" is a success and not a failure
 *
 * A CronJob whose pods exit non-zero retries, backs off, and fills the namespace with Failed jobs
 * and the alerting channel with noise — for the expected condition of "we do not have the keys yet".
 * So the absence of credentials is a clean exit 0 carrying an explicit `not_configured` outcome and
 * a message naming the missing variables. It is loud in the log and quiet in the scheduler, which is
 * the correct way round. A value that is present but unusable is the opposite case and does fail the
 * run — including an endpoint whose host contradicts the declared feed tier.
 */

import { randomUUID } from 'node:crypto';

import {
  type BrightClientOptions,
  type BrightMetadataProbe,
  createTokenProvider,
  probeMetadata,
} from './bright-client';
import { type BrightConfig, resolveBrightConfig } from './config';
import { crawlResource, type CrawlResourceResult } from './crawl';
import { RateLimiter } from './rate-limiter';
import { replicateResource, type ReplicateResourceResult, ReplicationFailure } from './replicate';
import { BRIGHT_RESOURCES, resolveCrawlResource, resolveResource } from './resources';
import {
  type BrightResourceReport,
  type BrightRunCounts,
  type BrightRunLogSink,
  type BrightRunOutcome,
  consoleRunLogSink,
  ZERO_COUNTS,
} from './run-log';
import { type BrightStagingStore, createStagingStore } from './staging-store';

import {
  type BrightMapRunReport,
  type BrightMediaMapReport,
  ZERO_MAP_REPORT,
  ZERO_MEDIA_MAP_REPORT,
} from '../bright-map/report';

/** The resource whose staged keys the crawl matches media against (#191). */
const PROPERTY_RESOURCE = 'BrightProperties';

export interface BrightIngestRunResult {
  readonly runId: string;
  readonly outcome: BrightRunOutcome;
  readonly durationMs: number;
  readonly counts: BrightRunCounts;
  readonly message: string;
  readonly tokenEndpointHost: string | null;
  readonly serviceRootHost: string | null;
  readonly resources: readonly BrightResourceReport[];
  readonly stalled: boolean;
}

export interface RunBrightIngestOptions extends BrightClientOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly sink?: BrightRunLogSink;
  /** Injected so a test can assert `durationMs` without sleeping. */
  readonly now?: () => Date;
  readonly runId?: string;
  /** Injected in tests. Production builds one from the shared pool. */
  readonly store?: BrightStagingStore;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /**
   * Maps `bright_staging_records` into the consumer schema (#93), run after every resource has
   * replicated. Defaults to a no-op that reports zero work: a test that does not inject this (and
   * every test in this file today) exercises replication only, exactly as before #93. Production
   * wiring lives in `bright-ingest.main.ts`, which passes the real
   * `mapStagedBrightProperties(getPool(), ...)` — never here, so this file never imports `db/pool`.
   */
  readonly mapRecords?: (params: { feed: 'test' | 'production' }) => Promise<BrightMapRunReport>;
  /**
   * Maps staged `BrightMedia` rows into `listing_media` (#191). Same injection contract as
   * `mapRecords`: defaults to a no-op so a replication test stays a replication test, and the real
   * wiring lives in `bright-ingest.main.ts`, which owns the pool.
   */
  readonly mapMedia?: () => Promise<BrightMediaMapReport>;
}

const NO_OP_MAP_RECORDS = async (): Promise<BrightMapRunReport> => ZERO_MAP_REPORT;
const NO_OP_MAP_MEDIA = async (): Promise<BrightMediaMapReport> => ZERO_MEDIA_MAP_REPORT;

/** ISO-8601 with a `Z` suffix — one wire format per service (see the project guide). */
function instant(at: Date): string {
  return at.toISOString();
}

function notConfiguredMessage(config: Extract<BrightConfig, { state: 'not-configured' }>): string {
  return (
    'Bright MLS credentials are not configured: ' +
    `${config.missing.join(', ')} ${config.missing.length === 1 ? 'is' : 'are'} unset or still ` +
    'the committed placeholder. Nothing was ingested and nothing was written. Every overlay now ' +
    'carries an endpoint pair (#176), so this means the secret is missing: either #117 has not ' +
    "provisioned this environment's, or the overlay lost its endpoint pair. See " +
    'apps/services/property-service/docs/bright-mls-day-one-checklist.md.'
  );
}

/**
 * Folds a crawl result into the same report shape a replication pass produces (#191).
 *
 * A crawl has no timestamp cursor, so the cursor fields are null and `stalled` is false. Reporting
 * them as null is the honest answer: a crawl cannot be behind by time, only by pages.
 *
 * `caughtUp` carries `passComplete`, which is the equivalent claim — the pass reached the end of
 * the resource. `nextLinkStored` is deliberately not carried: it is an internal resume detail, and
 * `cappedByPageLimit` already tells an operator the run will continue next time.
 */
function toCrawlReport(result: CrawlResourceResult): BrightResourceReport {
  return {
    resource: result.resource,
    pagesFetched: result.pagesFetched,
    recordsFetched: result.recordsFetched,
    recordsStaged: result.recordsStaged,
    retries: result.retries,
    cursorAt: null,
    cursorAgeHours: null,
    caughtUp: result.passComplete,
    cappedByPageLimit: result.cappedByPageLimit,
    starved: false,
    stalled: false,
  };
}

/** One sentence on the media pass, appended to the run message. */
function mediaMessage(media: BrightMediaMapReport): string {
  if (media.staged === 0) {
    return 'No media was staged, so no photo was written.';
  }
  return (
    `Media: mapped ${media.mapped}/${media.staged} staged row(s), wrote ${media.mediaWritten} ` +
    `photo(s) across ${media.listingsWithMedia} listing(s), ${media.unmatchedMedia} row(s) had no ` +
    'listing.' +
    (media.rejected === 0 ? '' : ` Rejected by reason: ${formatCounts(media.rejectedByReason)}.`)
  );
}

function toReport(
  result: ReplicateResourceResult,
  cursorMaxAgeHours: number,
): BrightResourceReport {
  return {
    resource: result.resource,
    pagesFetched: result.pagesFetched,
    recordsFetched: result.recordsFetched,
    recordsStaged: result.recordsStaged,
    retries: result.retries,
    cursorAt: result.cursorAfter.modifiedAt,
    cursorAgeHours: result.cursorAgeHours,
    caughtUp: result.caughtUp,
    cappedByPageLimit: result.cappedByPageLimit,
    starved: result.starved,
    stalled: result.cursorAgeHours !== null && result.cursorAgeHours > cursorMaxAgeHours,
  };
}

function summarise(
  reports: readonly BrightResourceReport[],
  deletionsDetected: number,
  mapping: BrightMapRunReport = ZERO_MAP_REPORT,
): BrightRunCounts {
  return {
    recordsFetched: reports.reduce((total, r) => total + r.recordsFetched, 0),
    recordsStaged: reports.reduce((total, r) => total + r.recordsStaged, 0),
    // #93 maps staging into the consumer schema. Zero until mapRecords() actually ran and published.
    recordsUpserted: mapping.published,
    deletionsDetected,
    retries: reports.reduce((total, r) => total + r.retries, 0),
    pagesFetched: reports.reduce((total, r) => total + r.pagesFetched, 0),
  };
}

function replicatedMessage(
  config: Extract<BrightConfig, { state: 'configured' }>,
  reports: readonly BrightResourceReport[],
  counts: BrightRunCounts,
  mapping: BrightMapRunReport,
): string {
  const behind = reports.filter((r) => r.cappedByPageLimit).map((r) => r.resource);
  const stalled = reports.filter((r) => r.stalled).map((r) => r.resource);
  const starved = reports.filter((r) => r.starved).map((r) => r.resource);
  return (
    `Replicated ${counts.recordsStaged} record(s) into staging from ` +
    `${config.endpoint.serviceRootHost} over ${counts.pagesFetched} page(s), feed tier ` +
    `${config.feed}, ${counts.retries} retry/retries. ` +
    (behind.length === 0
      ? 'Every resource reached the end of the feed. '
      : `Still behind and resuming next run: ${behind.join(', ')}. `) +
    (stalled.length === 0
      ? ''
      : `STALLED CURSOR beyond ${config.replication.cursorMaxAgeHours}h: ${stalled.join(', ')}. `) +
    (starved.length === 0
      ? ''
      : `STARVED on a tie block, the cursor cannot advance: ${starved.join(', ')}. `) +
    (mapping.staged === 0
      ? 'No consumer row was written: mapping is #93.'
      : `Mapped ${mapping.mapped}/${mapping.staged} staged record(s), published ${mapping.published}, ` +
        `withheld ${mapping.withheld}, taken down ${mapping.takenDown}, sample-marked ` +
        `${mapping.sampleMarked}.` +
        (mapping.withheld === 0 ? '' : ` Withheld by reason: ${formatWithheldByReason(mapping)}.`) +
        (Object.keys(mapping.outOfRangeFieldCounts).length === 0
          ? ''
          : ` Field(s) dropped for an out-of-range value: ${formatCounts(mapping.outOfRangeFieldCounts)}.`))
  );
}

/** `{key: count}` sorted by count descending, so the largest cause reads first. */
function formatCounts(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
}

function formatWithheldByReason(mapping: BrightMapRunReport): string {
  return formatCounts(mapping.withheldByReason);
}

/**
 * Runs one ingestion cycle and emits exactly two log records — `run_started` and `run_finished`.
 *
 * Never throws: a failure is reported as the `failed` outcome so that the `run_finished` record is
 * emitted on every path. A run that dies without a terminal record is a run nobody can account for,
 * which is precisely what the structured log exists to prevent.
 */
export async function runBrightIngest(
  options: RunBrightIngestOptions = {},
): Promise<BrightIngestRunResult> {
  const env = options.env ?? process.env;
  const sink = options.sink ?? consoleRunLogSink;
  const now = options.now ?? (() => new Date());
  const runId = options.runId ?? randomUUID();

  const startedAt = now();

  // Resolved before the first log record so the endpoint hosts are on BOTH records. A run that
  // fails during configuration still has to say which feed it was aiming at.
  let config: BrightConfig | null = null;
  let configError: unknown = null;
  try {
    config = resolveBrightConfig(env);
  } catch (error) {
    configError = error;
  }

  const tokenEndpointHost = config?.endpoint?.tokenEndpointHost ?? null;
  const serviceRootHost = config?.endpoint?.serviceRootHost ?? null;

  sink({
    job: 'bright-mls-ingest',
    runId,
    at: instant(startedAt),
    event: 'run_started',
    tokenEndpointHost,
    serviceRootHost,
  });

  let outcome: BrightRunOutcome;
  let message: string;
  let metadata: BrightMetadataProbe | undefined;
  const reports: BrightResourceReport[] = [];
  let counts: BrightRunCounts = ZERO_COUNTS;
  let feed: 'test' | 'production' | undefined;
  let mappingWithheldByReason: Readonly<Record<string, number>> | undefined;
  let mappingOutOfRangeFieldCounts: Readonly<Record<string, number>> | undefined;

  // `config === null` and `configError !== null` are the same condition — resolveBrightConfig either
  // returned or threw. Testing the null rather than the error is what lets the compiler narrow
  // `config` on the branches below, so no cast is needed and a future edit that breaks the pairing
  // becomes a type error instead of a runtime one.
  if (config === null) {
    outcome = 'failed';
    message =
      configError instanceof Error
        ? configError.message
        : `Bright MLS configuration is unusable: ${String(configError)}`;
  } else if (config.state === 'not-configured') {
    outcome = 'not_configured';
    message = notConfiguredMessage(config);
  } else {
    feed = config.feed;
    try {
      const { replication } = config;
      // `options.now` returns a Date for the run clock; the token cache wants epoch milliseconds.
      // Derived rather than passed straight through, so one injected clock still drives both.
      const tokenProvider = createTokenProvider(config.endpoint, config.credentials, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        now: () => now().getTime(),
      });
      metadata = await probeMetadata(config.endpoint, await tokenProvider(), options);

      // ONE limiter for the whole run. Two callers each staying under the ceiling is how a shared
      // ceiling gets exceeded, which is the criterion this object exists to satisfy.
      const limiter = new RateLimiter(
        {
          requestsPerSecond: replication.requestsPerSecond,
          requestsPerMinute: replication.requestsPerMinute,
          maxConcurrency: replication.maxConcurrency,
        },
        { sleep: options.sleep },
      );

      const store = options.store ?? createStagingStore();
      const resources = replication.resources.map(resolveResource);

      if (replication.fullResync) {
        for (const resource of resources) {
          await store.resetCursor(resource.entitySet, runId);
        }
      }

      let deletionsDetected = 0;
      for (const resource of resources) {
        const result = await replicateResource({
          resource,
          serviceRoot: config.endpoint.serviceRoot,
          serviceRootHost: config.endpoint.serviceRootHost,
          tokenProvider,
          store,
          runId,
          initialCursor: replication.initialCursor,
          maxPagesPerRun: replication.maxPagesPerRun,
          pageOptions: {
            ...options,
            limiter,
            maxRetries: replication.maxRetries,
          },
          now,
        });
        if (resource.kind === 'deletions') {
          deletionsDetected += result.recordsStaged;
        }
        reports.push(toReport(result, replication.cursorMaxAgeHours));
      }

      // The full-crawl pass (#191), after replication and before mapping. Ordered, not incidental:
      // the crawl matches media against the `ListingKey`s replication just staged, so running it
      // first would match against the previous run's set and miss every new listing's photos.
      for (const resource of replication.crawlResources.map(resolveCrawlResource)) {
        const result = await crawlResource({
          resource,
          serviceRoot: config.endpoint.serviceRoot,
          serviceRootHost: config.endpoint.serviceRootHost,
          tokenProvider,
          store,
          runId,
          keepRecordKeys: await store.readRecordKeys(PROPERTY_RESOURCE),
          maxPagesPerRun: replication.crawlMaxPagesPerRun,
          pageOptions: { ...options, limiter, maxRetries: replication.maxRetries },
          now,
        });
        reports.push(toCrawlReport(result));
      }

      const mapRecords = options.mapRecords ?? NO_OP_MAP_RECORDS;
      const mapping = await mapRecords({ feed: config.feed });
      // Media mapping runs AFTER property mapping. A photo references a listing row, so the row
      // has to exist first.
      const mapMedia = options.mapMedia ?? NO_OP_MAP_MEDIA;
      const mediaMapping = await mapMedia();

      counts = summarise(reports, deletionsDetected, mapping);
      outcome = 'replicated';
      message = `${replicatedMessage(config, reports, counts, mapping)} ${mediaMessage(mediaMapping)}`;
      if (mapping.withheld > 0) {
        mappingWithheldByReason = mapping.withheldByReason;
      }
      if (Object.keys(mapping.outOfRangeFieldCounts).length > 0) {
        mappingOutOfRangeFieldCounts = mapping.outOfRangeFieldCounts;
      }
    } catch (error) {
      outcome = 'failed';
      message = error instanceof Error ? error.message : String(error);
      // Keep whatever completed before the failure. A pass that staged 40,000 rows and then hit a
      // 500 has still moved its cursor, and a report that hid that would make the next run look
      // like it skipped work.
      if (error instanceof ReplicationFailure) {
        reports.push(toReport(error.partial, config.replication.cursorMaxAgeHours));
      }
      counts = summarise(
        reports,
        reports
          .filter((report) => BRIGHT_RESOURCES[report.resource]?.kind === 'deletions')
          .reduce((total, report) => total + report.recordsStaged, 0),
      );
    }
  }

  const finishedAt = now();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  const stalled = reports.some((report) => report.stalled);

  sink({
    job: 'bright-mls-ingest',
    runId,
    at: instant(finishedAt),
    event: 'run_finished',
    tokenEndpointHost,
    serviceRootHost,
    outcome,
    durationMs,
    counts,
    message,
    ...(feed === undefined ? {} : { feed }),
    ...(reports.length === 0 ? {} : { resources: reports, stalled }),
    ...(mappingWithheldByReason === undefined ? {} : { mappingWithheldByReason }),
    ...(mappingOutOfRangeFieldCounts === undefined ? {} : { mappingOutOfRangeFieldCounts }),
    ...(metadata === undefined
      ? {}
      : {
          metadata: {
            odataVersion: metadata.odataVersion,
            byteLength: metadata.byteLength,
            sha256: metadata.sha256,
          },
        }),
  });

  return {
    runId,
    outcome,
    durationMs,
    counts,
    message,
    tokenEndpointHost,
    serviceRootHost,
    resources: reports,
    stalled,
  };
}
