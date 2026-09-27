/**
 * The four sync modes (#338): backfill, incremental, reconcile and audit.
 *
 * Pure orchestration over `SyncDeps`. The Bright calls, the database writes and the clock are
 * injected, so `sync.spec.ts` drives every mode with fakes. `worker.ts` supplies the real ones.
 *
 * Every mode reads Bright through `drainSlices`: Bright ignores `$orderby=ListingKey`, so a keyset
 * skips records (see `odata-query.ts`). A slice is sized by `$count` and read in one request.
 */

import type { BrightPage } from '../bright-ingest/bright-client';
import {
  type BrightArea,
  buildCountQuery,
  buildSliceCountQuery,
  buildSliceQuery,
  type SliceBounds,
  type SliceScope,
} from '../bright-ingest/odata-query';
import { BRIGHT_SYNC_SELECT } from './select';

/** Records per request. `$top` suppresses `@odata.nextLink`, so a slice is sized to one page. */
export const PAGE_SIZE = 1000;

/** The lower bound of a full pass. Bright holds no record modified before it. */
export const EPOCH = '1970-01-01T00:00:00.000Z';

/** A slice splits into at most this many parts per level. */
const MAX_SPLIT = 16;
/** Target records per slice after a split, below `PAGE_SIZE` so an uneven split still fits. */
const SPLIT_TARGET = 700;
/** Bright timestamps have whole-second precision. A narrower window cannot split further. */
const MIN_WINDOW_MS = 1000;
/** Above every `ListingKey` Bright issues (12 digits on 2026-09-26). */
const MAX_LISTING_KEY = 10n ** 15n;

/** The `StandardStatus` payload values search shows. `Closed` is sold history, gated apart. */
export const LIVE_STATUSES: readonly string[] = Object.freeze([
  'Active',
  'ComingSoon',
  'ActiveUnderContract',
  'Pending',
]);
export const SOLD_STATUS = 'Closed';

/**
 * Reconcile refuses to take listings down when a status read returns fewer keys than Bright's own
 * count by more than this share. The feed moves while the read runs, so an exact match is not
 * expected. A larger shortfall means the read failed, not that the listings left the market.
 */
export const RECONCILE_SHORTFALL_TOLERANCE = 0.01;

/**
 * Reconcile refuses to take down more than this share of the local live listings in one run. A
 * larger share is a read or a mapping fault. An operator runs a backfill instead.
 */
export const RECONCILE_MAX_TAKEDOWN_SHARE = 0.2;

/** Reconcile checks at most this many absent keys one by one before it takes them down. */
export const RECONCILE_MAX_VERIFY = 500;

export interface Checkpoint {
  readonly stream: string;
  readonly state: unknown;
}

export interface PageResult {
  readonly staged: number;
  readonly mapped: number;
  readonly published: number;
  readonly withheld: number;
  readonly takenDown: number;
  readonly withheldByReason: Readonly<Record<string, number>>;
}

export interface SyncDeps {
  readonly serviceRoot: string;
  readonly fetchPage: (url: string) => Promise<BrightPage>;
  /**
   * Stages and maps one page, takes down each held listing the mapper now rejects, and writes
   * `checkpoint` in the same transaction as the mapping.
   */
  readonly applyPage: (
    records: readonly Record<string, unknown>[],
    checkpoint: Checkpoint | null,
  ) => Promise<PageResult>;
  readonly readState: <T>(stream: string) => Promise<T | null>;
  readonly writeState: (stream: string, state: unknown) => Promise<void>;
  readonly progress: (counts: Record<string, unknown>, cursor: unknown) => Promise<void>;
  readonly now: () => Date;
  readonly log: (message: string) => void;
}

interface Bucket {
  pages: number;
  fetched: number;
  mapped: number;
  published: number;
  withheld: number;
  takenDown: number;
}

/** Per-bucket totals a run stores in `bright_sync_runs.counts`. */
class Tally {
  private readonly buckets = new Map<string, Bucket>();
  private readonly reasons: Record<string, number> = {};
  requests = 0;

  add(bucket: string, result: PageResult): void {
    const current: Bucket = this.buckets.get(bucket) ?? {
      pages: 0,
      fetched: 0,
      mapped: 0,
      published: 0,
      withheld: 0,
      takenDown: 0,
    };
    current.pages += 1;
    current.fetched += result.staged;
    current.mapped += result.mapped;
    current.published += result.published;
    current.withheld += result.withheld;
    current.takenDown += result.takenDown;
    this.buckets.set(bucket, current);
    for (const [reason, count] of Object.entries(result.withheldByReason)) {
      this.reasons[reason] = (this.reasons[reason] ?? 0) + count;
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      byStatus: Object.fromEntries(this.buckets),
      withheldByReason: { ...this.reasons },
      brightRequests: this.requests,
    };
  }
}

/** `ListingKey` as decimal text. Bright sends a number below 2^53. */
export function listingKeyOf(record: Readonly<Record<string, unknown>>): string {
  const key = record.ListingKey;
  if (typeof key === 'number' && Number.isSafeInteger(key) && key >= 0) return String(key);
  if (typeof key === 'string' && /^\d+$/.test(key)) return key;
  throw new Error(`Bright returned a record with no usable ListingKey (${String(key)}).`);
}

async function countOf(deps: SyncDeps, url: string, tally?: Tally): Promise<number> {
  const page = await deps.fetchPage(url);
  if (tally !== undefined) tally.requests += 1;
  if (page.count === undefined) {
    throw new Error('Bright answered a $count=true request with no @odata.count.');
  }
  return page.count;
}

/** `parts` equal windows of `(from, until]`, as ISO instants. */
function splitWindow(from: string, until: string, parts: number): SliceBounds[] {
  const start = Date.parse(from);
  const end = Date.parse(until);
  const step = Math.max(MIN_WINDOW_MS, Math.ceil((end - start) / parts));
  const out: SliceBounds[] = [];
  for (let lo = start; lo < end; lo += step) {
    const hi = Math.min(end, lo + step);
    out.push({ from: new Date(lo).toISOString(), until: new Date(hi).toISOString() });
  }
  return out;
}

/** `parts` equal `ListingKey` ranges of `(after, until]` inside one window. */
function splitKeys(bounds: SliceBounds, parts: number): SliceBounds[] {
  const after = BigInt(bounds.keyAfter ?? '0');
  const until = BigInt(bounds.keyUntil ?? MAX_LISTING_KEY.toString());
  const span = until - after;
  if (span <= 1n) {
    throw new Error(
      `One ListingKey (${until}) matches more than ${PAGE_SIZE} records. The slice cannot split.`,
    );
  }
  const n = BigInt(parts) > span ? span : BigInt(parts);
  const step = (span + n - 1n) / n;
  const out: SliceBounds[] = [];
  for (let lo = after; lo < until; lo += step) {
    const hi = lo + step > until ? until : lo + step;
    out.push({ ...bounds, keyAfter: lo.toString(), keyUntil: hi.toString() });
  }
  return out;
}

/**
 * Reads every record in `scope` within `bounds`, in slices of at most one page, oldest window
 * first. `onSlice` sees each non-empty slice once, with its bounds, in that order.
 */
export async function drainSlices(
  deps: SyncDeps,
  scope: SliceScope,
  bounds: SliceBounds,
  select: readonly string[],
  onSlice: (records: readonly Record<string, unknown>[], bounds: SliceBounds) => Promise<void>,
  tally?: Tally,
  ordered = false,
): Promise<void> {
  const total = await countOf(deps, buildSliceCountQuery(deps.serviceRoot, scope, bounds), tally);
  if (total === 0) {
    return;
  }
  let size = total;
  if (total < PAGE_SIZE) {
    const page = await deps.fetchPage(
      buildSliceQuery(deps.serviceRoot, scope, bounds, { top: PAGE_SIZE, select, ordered }),
    );
    if (tally !== undefined) tally.requests += 1;
    // A full page means the slice grew after the count, and `$top` cut it. Split it instead.
    if (page.records.length < PAGE_SIZE) {
      await onSlice(page.records, bounds);
      return;
    }
    size = page.records.length + 1;
  }
  const parts = Math.min(MAX_SPLIT, Math.max(2, Math.ceil(size / SPLIT_TARGET)));
  const byTime = bounds.keyAfter === undefined && bounds.keyUntil === undefined;
  const children =
    byTime && Date.parse(bounds.until) - Date.parse(bounds.from) > MIN_WINDOW_MS
      ? splitWindow(bounds.from, bounds.until, parts)
      : splitKeys(bounds, parts);
  for (const child of children) {
    await drainSlices(deps, scope, child, select, onSlice, tally, ordered);
  }
}

/* ─── Backfill ─────────────────────────────────────────────────────────────────────────────── */

export interface BackfillState {
  /** Every record modified at or before this instant is written. `null` before the first slice. */
  readonly through: string | null;
  readonly complete: boolean;
}

export interface BackfillOptions {
  readonly statuses: readonly string[];
  /** Scopes the pass to one place. An area pass keeps no checkpoint. */
  readonly area?: BrightArea;
  /** Skip a status whose checkpoint reads complete. Without it a complete status starts over. */
  readonly resume: boolean;
  /** `CloseDate ge <date>` for the `Closed` pass. */
  readonly soldCloseDateFrom: string;
}

export function backfillStream(status: string): string {
  return `backfill:${status}`;
}

/**
 * Per status, every record modified in `(EPOCH, now]`, in `$count`-sized slices, oldest first. The
 * checkpoint is the upper bound of the last written slice, written in that slice's mapping
 * transaction. A restart resumes after it, and the upserts make any re-read a no-op.
 */
export async function runBackfill(
  deps: SyncDeps,
  options: BackfillOptions,
): Promise<Record<string, unknown>> {
  const tally = new Tally();
  const until = deps.now().toISOString();
  for (const status of options.statuses) {
    const stream = options.area === undefined ? backfillStream(status) : null;
    const prior = stream === null ? null : await deps.readState<BackfillState>(stream);
    if (options.resume && prior?.complete === true) {
      continue;
    }
    const from =
      prior !== null && !prior.complete && prior.through !== null ? prior.through : EPOCH;
    deps.log(`Backfill ${status}: records modified after ${from}.`);
    const scope: SliceScope = {
      status,
      ...(status === SOLD_STATUS ? { closeDateFrom: options.soldCloseDateFrom } : {}),
      ...(options.area === undefined ? {} : { area: options.area }),
    };

    await drainSlices(
      deps,
      scope,
      { from, until },
      BRIGHT_SYNC_SELECT,
      async (records, bounds) => {
        // A key range inside one instant leaves that instant incomplete, so the checkpoint stays
        // at the instant's lower bound until its last key range is written.
        const through =
          bounds.keyUntil === undefined || BigInt(bounds.keyUntil) >= MAX_LISTING_KEY
            ? bounds.until
            : bounds.from;
        const state: BackfillState = { through, complete: false };
        tally.add(
          status,
          await deps.applyPage(records, stream === null ? null : { stream, state }),
        );
        await deps.progress(tally.snapshot(), { status, through });
      },
      tally,
    );
    if (stream !== null) {
      await deps.writeState(stream, { through: until, complete: true } satisfies BackfillState);
    }
  }
  return tally.snapshot();
}

/* ─── Incremental ──────────────────────────────────────────────────────────────────────────── */

export const INCREMENTAL_STREAM = 'incremental';

export interface IncrementalState {
  /** The window end of the last committed pass. */
  readonly watermark: string;
}

export interface IncrementalOptions {
  readonly overlapMs: number;
}

/**
 * One bounded change window, `(watermark - overlap, now]`, every status, ordered by
 * `ModificationTimestamp,ListingKey`. A record that left the searchable set maps to its new status
 * and drops out of search through the view. The watermark moves only after every slice commits.
 */
export async function runIncremental(
  deps: SyncDeps,
  options: IncrementalOptions,
): Promise<Record<string, unknown>> {
  const prior = await deps.readState<IncrementalState>(INCREMENTAL_STREAM);
  if (prior === null) {
    throw new Error('No incremental watermark is recorded. Run a backfill first.');
  }
  const until = deps.now().toISOString();
  const from = new Date(Date.parse(prior.watermark) - options.overlapMs).toISOString();
  const tally = new Tally();

  await drainSlices(
    deps,
    {},
    { from, until },
    BRIGHT_SYNC_SELECT,
    async (records, bounds) => {
      tally.add('changes', await deps.applyPage(records, null));
      await deps.progress(tally.snapshot(), bounds);
    },
    tally,
    true,
  );

  await deps.writeState(INCREMENTAL_STREAM, { watermark: until } satisfies IncrementalState);
  return { ...tally.snapshot(), window: { from, until } };
}

/* ─── Reconcile ────────────────────────────────────────────────────────────────────────────── */

export interface ReconcileDeps {
  /** Local, not deleted Bright listings in `statuses` (payload values): key to listing id. */
  readonly listLiveLocal: (statuses: readonly string[]) => Promise<Map<string, string>>;
  /** Marks the listings Off market through `src/db/write.ts` (#349). Returns the count changed. */
  readonly takeDown: (listingIds: readonly string[], reason: string) => Promise<number>;
}

/** Whether Bright still lists `listingKey` in one of `statuses`, read for that key alone. */
async function stillLive(
  deps: SyncDeps,
  listingKey: string,
  statuses: readonly string[],
): Promise<boolean> {
  const search = new URLSearchParams();
  search.set('$filter', `ListingKey eq ${listingKey}`);
  search.set('$select', 'ListingKey,StandardStatus');
  search.set('$top', '1');
  const page = await deps.fetchPage(
    `${deps.serviceRoot.replace(/\/+$/, '')}/BrightProperties?${search.toString()}`,
  );
  const status = page.records[0]?.StandardStatus;
  return typeof status === 'string' && statuses.includes(status);
}

/**
 * Reads every live `ListingKey` per status and takes down the local live listings Bright no
 * longer lists in any of them. A record modified while the read runs can fall outside its window,
 * so each absent key is read once more by itself. Refuses on a short read or an outsized takedown.
 */
export async function runReconcile(
  deps: SyncDeps & ReconcileDeps,
  options: { readonly statuses: readonly string[] },
): Promise<Record<string, unknown>> {
  const live = new Set<string>();
  const byStatus: Record<string, { bright: number; read: number }> = {};
  const until = deps.now().toISOString();

  for (const status of options.statuses) {
    const expected = await countOf(
      deps,
      buildCountQuery({ serviceRoot: deps.serviceRoot, status }),
    );
    let read = 0;
    await drainSlices(deps, { status }, { from: EPOCH, until }, ['ListingKey'], async (records) => {
      for (const record of records) live.add(listingKeyOf(record));
      read += records.length;
    });
    byStatus[status] = { bright: expected, read };
    await deps.progress({ byStatus }, { status });
    if (read < expected * (1 - RECONCILE_SHORTFALL_TOLERANCE)) {
      throw new Error(
        `Reconcile read ${read} ${status} keys but Bright counts ${expected}. Nothing was taken down.`,
      );
    }
  }

  const local = await deps.listLiveLocal(options.statuses);
  const absent = [...local].filter(([key]) => !live.has(key));
  if (local.size > 0 && absent.length > local.size * RECONCILE_MAX_TAKEDOWN_SHARE) {
    throw new Error(
      `Reconcile would take down ${absent.length} of ${local.size} live listings. Nothing was ` +
        'taken down. Check the Bright read, then run a backfill.',
    );
  }
  // Only a key checked by itself is taken down. Keys past the budget wait for the next run.
  const gone: string[] = [];
  let keptLive = 0;
  const checked = absent.slice(0, RECONCILE_MAX_VERIFY);
  for (const [key, id] of checked) {
    if (await stillLive(deps, key, options.statuses)) {
      keptLive += 1;
    } else {
      gone.push(id);
    }
  }
  const takenDown = await deps.takeDown(gone, 'Bright sync reconcile: absent from Bright');
  return {
    byStatus,
    liveKeys: live.size,
    localLive: local.size,
    keptLive,
    unchecked: absent.length - checked.length,
    takenDown,
  };
}

/* ─── Audit ────────────────────────────────────────────────────────────────────────────────── */

export interface AuditArea {
  readonly label: string;
  /** Absent means the whole feed. */
  readonly area?: BrightArea;
}

/** The places the stakeholder compares with Zillow and Homes.com (#338). */
export const DEFAULT_AUDIT_AREAS: readonly AuditArea[] = Object.freeze([
  { label: 'Whole feed' },
  { label: 'Washington, DC', area: { state: 'DC' } },
  { label: 'Baltimore, MD', area: { city: 'Baltimore', state: 'MD' } },
  { label: 'Frederick, MD', area: { city: 'Frederick', state: 'MD' } },
  { label: 'Silver Spring, MD', area: { city: 'Silver Spring', state: 'MD' } },
  { label: 'Arlington, VA', area: { city: 'Arlington', state: 'VA' } },
  { label: 'Alexandria, VA', area: { city: 'Alexandria', state: 'VA' } },
  { label: 'ZIP 20002', area: { zip: '20002' } },
]);

export interface AuditDeps {
  /** Local, not deleted Bright listings in `area` whose status maps from `status`. */
  readonly countLocal: (area: BrightArea | undefined, status: string) => Promise<number>;
}

export interface AuditRow {
  readonly area: string;
  readonly status: string;
  readonly bright: number;
  readonly local: number;
  /** `(bright - local) / bright`, as a percentage. `0` when Bright counts none. */
  readonly gapPct: number;
}

export async function runAudit(
  deps: SyncDeps & AuditDeps,
  options: { readonly areas: readonly AuditArea[]; readonly statuses: readonly string[] },
): Promise<{ rows: AuditRow[] }> {
  const rows: AuditRow[] = [];
  for (const { label, area } of options.areas) {
    for (const status of options.statuses) {
      const bright = await countOf(
        deps,
        buildCountQuery({
          serviceRoot: deps.serviceRoot,
          status,
          ...(area === undefined ? {} : { area }),
        }),
      );
      const local = await deps.countLocal(area, status);
      const gapPct = bright === 0 ? 0 : Math.round(((bright - local) / bright) * 10_000) / 100;
      rows.push({ area: label, status, bright, local, gapPct });
    }
    await deps.progress({ rows }, { area: label });
  }
  return { rows };
}
