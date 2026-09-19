/**
 * The Bright MLS ingestion run (#91) — the decision half.
 *
 * `bright-ingest.main.ts` is the program that invokes this; the split mirrors
 * `seed-on-start.ts` / `seed-on-start.main.ts` and exists for the same reason: a bundled entry point
 * cannot hold logic that anything wants to unit-test, because `require.main === module` is silently
 * always false inside a webpack bundle.
 *
 * ## What a run does today
 *
 * Resolves configuration, and then either:
 *
 *  - reports `not_configured` and finishes **successfully** — the expected steady state in `local`
 *    and `test`, and everywhere until #117 provisions credentials; or
 *  - authenticates and probes `$metadata`, reporting `probe_succeeded` with zero counts.
 *
 * It ingests nothing. Incremental RESO replication into a staging area is #92; mapping into
 * `properties`/`units`/`listings` is #93. Nothing under `src/jobs/bright-ingest/` opens a database
 * connection or issues SQL, and `no-consumer-writes.spec.ts` asserts that structurally rather than
 * trusting this comment — `src/db/write.ts` remains the only module that writes `listings`.
 *
 * ## Why "not configured" is a success and not a failure
 *
 * A CronJob whose pods exit non-zero retries, backs off, and fills the namespace with Failed jobs
 * and the alerting channel with noise — for the entirely expected condition of "we do not have the
 * keys yet". So the absence of credentials is a clean exit 0 carrying an explicit `not_configured`
 * outcome and a message naming the missing variables. It is loud in the log and quiet in the
 * scheduler, which is the correct way round. A value that is present but unusable is the opposite
 * case and does fail the run.
 */

import { randomUUID } from 'node:crypto';

import {
  acquireToken,
  type BrightClientOptions,
  type BrightMetadataProbe,
  probeMetadata,
} from './bright-client';
import { BRIGHT_ENV_VARS, type BrightConfig, resolveBrightConfig } from './config';
import {
  type BrightRunCounts,
  type BrightRunLogSink,
  type BrightRunOutcome,
  consoleRunLogSink,
  ZERO_COUNTS,
} from './run-log';

export interface BrightIngestRunResult {
  readonly runId: string;
  readonly outcome: BrightRunOutcome;
  readonly durationMs: number;
  readonly counts: BrightRunCounts;
  readonly message: string;
  readonly tokenEndpointHost: string | null;
  readonly serviceRootHost: string | null;
}

export interface RunBrightIngestOptions extends BrightClientOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly sink?: BrightRunLogSink;
  /** Injected so a test can assert `durationMs` without sleeping. */
  readonly now?: () => Date;
  readonly runId?: string;
}

/** ISO-8601 with a `Z` suffix — one wire format per service (see the project guide). */
function instant(at: Date): string {
  return at.toISOString();
}

function notConfiguredMessage(config: Extract<BrightConfig, { state: 'not-configured' }>): string {
  return (
    'Bright MLS credentials are not configured: ' +
    `${config.missing.join(', ')} ${config.missing.length === 1 ? 'is' : 'are'} unset or still ` +
    'the committed placeholder. Nothing was ingested and nothing was written. In local and test ' +
    'this is expected until #176 wires their endpoint pair. In dev and prod it is a fault: both ' +
    'are wired, so the secret is missing or the overlay lost its endpoint pair — check those, not ' +
    '#176. See apps/services/property-service/docs/bright-mls-day-one-checklist.md.'
  );
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
    try {
      const token = await acquireToken(config.endpoint, config.credentials, options);
      metadata = await probeMetadata(config.endpoint, token, options);
      outcome = 'probe_succeeded';
      message =
        `Authenticated against ${config.endpoint.tokenEndpointHost} and read $metadata from ` +
        `${config.endpoint.serviceRootHost} (${metadata.byteLength} bytes, OData-Version ` +
        `${metadata.odataVersion ?? 'not advertised'}). No records were ingested: replication is ` +
        `#92 and mapping is #93. Confirm the ${BRIGHT_ENV_VARS.serviceRoot} host above is the feed ` +
        'this environment is meant to read.';
    } catch (error) {
      outcome = 'failed';
      message = error instanceof Error ? error.message : String(error);
    }
  }

  const finishedAt = now();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  sink({
    job: 'bright-mls-ingest',
    runId,
    at: instant(finishedAt),
    event: 'run_finished',
    tokenEndpointHost,
    serviceRootHost,
    outcome,
    durationMs,
    counts: ZERO_COUNTS,
    message,
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
    counts: ZERO_COUNTS,
    message,
    tokenEndpointHost,
    serviceRootHost,
  };
}
