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
  /** No Bright credentials in this environment. Expected forever in `local` and `test`. */
  | 'not_configured'
  /** Authenticated and reached the service root. Nothing was ingested — that is #92/#93. */
  | 'probe_succeeded'
  /** Something present was unusable, or Bright refused us. Exit code is non-zero. */
  | 'failed';

/** Counts the siblings will populate. Present from day one so the record shape never changes. */
export interface BrightRunCounts {
  /** Records read from Bright. #92 populates this; zero until then. */
  readonly recordsFetched: number;
  /** Records written to the replication staging area. #92 populates this; zero until then. */
  readonly recordsStaged: number;
  /** Records mapped into the consumer schema. #93 populates this; zero until then. */
  readonly recordsUpserted: number;
}

export const ZERO_COUNTS: BrightRunCounts = {
  recordsFetched: 0,
  recordsStaged: 0,
  recordsUpserted: 0,
};

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
