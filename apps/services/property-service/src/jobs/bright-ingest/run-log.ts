/**
 * Structured run logging for the Bright MLS ingestion job (#91).
 *
 * One JSON object per line on stdout. This is the only logging the job does, and it exists now —
 * before there is anything to ingest — because #92 (incremental replication) and #93 (mapping into
 * the consumer schema) need a record shape to add counts to, and retrofitting one across a running
 * pipeline is how run history ends up unqueryable for the period that matters most.
 *
 * ## Why JSON lines rather than `console.info` prose
 *
 * The rest of `property-service` logs prose, and for a request-serving process that is fine. A
 * scheduled job is different: the questions asked of it are "did the 03:00 run finish", "when did
 * counts last change", "which endpoint did last night's run authenticate against" — all of which are
 * field lookups across many runs, not a human reading one startup line. `runId` correlates the pair
 * of records a single run emits.
 *
 * ## The redaction rule is structural, not a filter
 *
 * There is no scrubbing pass here, because a scrubber is a list of things someone remembered. Instead
 * the record types below simply have **nowhere to put** a credential: `BrightRunRecord` carries
 * `tokenEndpointHost` / `serviceRootHost` (see `config.ts` for why hosts and not URLs) and no field
 * of any type that a client id or secret could be assigned to without a compile error. The sink
 * receives a typed record, never a free-form object and never `...config`. The redaction assertions
 * live in `run.spec.ts` ("runBrightIngest — redaction"), because the guarantee is about what a whole
 * run emits, not about this module in isolation.
 *
 * The one field that had to be argued about is `message`, which is free text and therefore the one
 * place server-supplied content could reach a log line. `bright-client.ts` keeps only RFC 6749's
 * closed set of `error` CODES out of a failure body and drops `error_description` entirely — a
 * gateway answering `"Client 'abc123' not found"` would otherwise log the client id through it.
 */

/** Every terminal outcome a run can report. `notConfigured` is a success, not a degraded state. */
export type BrightRunOutcome =
  /** No Bright credentials in this environment. Expected while an environment waits on #117. */
  | 'not_configured'
  /**
   * Replicated into staging. Mapping into the consumer schema is still #93.
   *
   * There is deliberately no `probe_succeeded` outcome any more. #91 had one, and nothing emits it
   * now: a configured run always replicates. Keeping it would advertise a "replication off" switch
   * that does not exist, which an operator would look for.
   */
  | 'replicated'
  /** Something present was unusable, or Bright refused us. Exit code is non-zero. */
  | 'failed';

/** Counts for one run, summed over every resource it worked. */
export interface BrightRunCounts {
  /** Records read from Bright. */
  readonly recordsFetched: number;
  /** Records written to the replication staging tables. */
  readonly recordsStaged: number;
  /** Records mapped into the consumer schema. #93 populates this; zero until then. */
  readonly recordsUpserted: number;
  /** Rows staged from the `Deletion` resource — records that left the feed. */
  readonly deletionsDetected: number;
  /** Requests retried after a 429 or a 5xx. A rising number is the rate ceiling talking. */
  readonly retries: number;
  readonly pagesFetched: number;
}

export const ZERO_COUNTS: BrightRunCounts = {
  recordsFetched: 0,
  recordsStaged: 0,
  recordsUpserted: 0,
  deletionsDetected: 0,
  retries: 0,
  pagesFetched: 0,
};

/**
 * What one resource's pass did. Per resource rather than only summed, because "the run staged 4,000
 * rows" hides a media pass that has not advanced in a week behind a listings pass that is healthy.
 */
export interface BrightResourceReport {
  readonly resource: string;
  readonly pagesFetched: number;
  readonly recordsFetched: number;
  readonly recordsStaged: number;
  readonly retries: number;
  /** The cursor instant this pass reached. `null` before the resource has ever staged a record. */
  readonly cursorAt: string | null;
  /** Hours between that instant and the end of the run. */
  readonly cursorAgeHours: number | null;
  /** True when the pass read the feed to exhaustion. */
  readonly caughtUp: boolean;
  /** True when the per-run page cap stopped the pass with more to read. */
  readonly cappedByPageLimit: boolean;
  /**
   * True when the pass could not cross a block of records that all share one cursor instant.
   *
   * Bright rejects the OR a strict resume needs, so the filter is inclusive and progress depends on
   * the instant advancing. A tie block wider than the hard page cap never advances it, so every
   * later run repeats this one. This is a fault; `cappedByPageLimit` alone is not.
   */
  readonly starved: boolean;
  /**
   * True when the cursor is older than `BRIGHT_MLS_CURSOR_MAX_AGE_HOURS`.
   *
   * A stalled cursor is the failure this job cannot detect any other way: every run succeeds, every
   * count is plausible, and the data is a month old. It is a field rather than only a sentence in
   * `message` so an alert can match on it.
   */
  readonly stalled: boolean;
}

interface BrightRunRecordBase {
  readonly job: 'bright-mls-ingest';
  readonly runId: string;
  /** ISO-8601 instant, always `Z`-suffixed — the same wire format the service uses elsewhere. */
  readonly at: string;
  /**
   * Host only, never a full URL. This is the field that makes a staging credential running in
   * production visible in the first log line instead of inferred later from wrong-looking data.
   */
  readonly tokenEndpointHost: string | null;
  readonly serviceRootHost: string | null;
}

export interface BrightRunStartedRecord extends BrightRunRecordBase {
  readonly event: 'run_started';
}

export interface BrightRunFinishedRecord extends BrightRunRecordBase {
  readonly event: 'run_finished';
  readonly outcome: BrightRunOutcome;
  readonly durationMs: number;
  readonly counts: BrightRunCounts;
  /**
   * One human sentence explaining the outcome. For `not_configured` it names the missing variables,
   * which is the difference between a loud completion and a silent one.
   */
  readonly message: string;
  /** Present only on `probe_succeeded`; what the `$metadata` probe learned. See `bright-client.ts`. */
  readonly metadata?: {
    readonly odataVersion: string | null;
    readonly byteLength: number;
    readonly sha256: string;
  };
  /** Which Bright feed this environment is allowed to read. See `config.ts`. */
  readonly feed?: 'test' | 'production';
  /** Present on `replicated`. One entry per resource the run worked. */
  readonly resources?: readonly BrightResourceReport[];
  /**
   * Present on `replicated` when mapping withheld at least one staged record. Counts only, keyed by
   * the fixed `RejectReason` enum from `bright-map/map-record.ts` — never a record payload, address
   * or listing key, so this carries nothing the redaction rule above would forbid. Without this a
   * mass rejection is visible only as one aggregate `withheld` number in `message`, with no way to
   * tell a genuine data gap from a mapping defect (#207).
   */
  readonly mappingWithheldByReason?: Readonly<Record<string, number>>;
  /**
   * Present on `replicated` when a mapped record had a Bright field dropped to `null` for
   * overflowing its `integer` column (#237) — e.g. `LotSizeSquareFeet` outside Postgres's `integer`
   * range. Counts only, keyed by the Bright field name. The record still publishes; unlike
   * `mappingWithheldByReason` this is a data-quality signal, not a rejection.
   */
  readonly mappingOutOfRangeFieldCounts?: Readonly<Record<string, number>>;
  /** True when any resource reported a stalled cursor. Hoisted so one field answers "is it fresh?". */
  readonly stalled?: boolean;
}

export type BrightRunRecord = BrightRunStartedRecord | BrightRunFinishedRecord;

/** Where records go. Injected so tests capture them instead of parsing stdout. */
export type BrightRunLogSink = (record: BrightRunRecord) => void;

/**
 * The default sink. `console.info` rather than `process.stdout.write` so the Jest environment and a
 * container's log collector see it the same way the rest of this service is seen.
 */
export const consoleRunLogSink: BrightRunLogSink = (record) => {
  console.info(JSON.stringify(record));
};
