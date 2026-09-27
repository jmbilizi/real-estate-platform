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

/**
 * Records per request when `deps.pageSize` is not set. `$top` suppresses `@odata.nextLink`, so a
 * slice is sized to one page. Production defaults to `BRIGHT_SYNC_PAGE_SIZE` (see `worker.ts`),
 * measured faster per row the larger it is (#348); this constant only backstops a caller — a test
 * harness — that builds `SyncDeps` without one.
 */
export const PAGE_SIZE = 1000;

/** The lower bound of a full pass. Bright holds no record modified before it. */
export const EPOCH = '1970-01-01T00:00:00.000Z';

/** A slice splits into at most this many parts per level. */
const MAX_SPLIT = 16;
/** Target share of the page size per slice after a split, so an uneven split still fits one page. */
const SPLIT_TARGET_SHARE = 0.7;
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
  /** Records per request (`$top`). Defaults to `PAGE_SIZE` when absent (a test harness). */
  readonly pageSize?: number;
  /**
   * Leaf slices `drainSlices` fetches ahead of `onSlice` at once. Unbounded when absent (a test
   * harness). This, not the HTTP-level `RateLimiter`, is what bounds memory (#348): the
   * `RateLimiter`'s own concurrency only caps requests actually in flight, and releases a slot as
   * soon as the response arrives, before its data is applied — so on its own it would let every
   * slice in a backfill fetch ahead of a slow `onSlice` and pile up in memory.
   */
  readonly concurrency?: number;
  /**
   * Slices applied at once (#359). Bounds `BRIGHT_SYNC_APPLY_CONCURRENCY` connections' worth of
   * concurrent `applyPage` transactions. Defaults to 1 (strictly sequential) when absent, so a test
   * harness that does not set it keeps the old one-page-at-a-time behaviour.
   */
  readonly applyConcurrency?: number;
  /** Stages and maps one page, and takes down each held listing the mapper now rejects. */
  readonly applyPage: (records: readonly Record<string, unknown>[]) => Promise<PageResult>;
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
function splitKeys(bounds: SliceBounds, parts: number, pageSize: number): SliceBounds[] {
  const after = BigInt(bounds.keyAfter ?? '0');
  const until = BigInt(bounds.keyUntil ?? MAX_LISTING_KEY.toString());
  const span = until - after;
  if (span <= 1n) {
    throw new Error(
      `One ListingKey (${until}) matches more than ${pageSize} records. The slice cannot split.`,
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
 * Every leaf slice inside `bounds`, oldest first — `$count` queries only, no data, no `onSlice`.
 * Order-independent and side-effect-free besides `tally`, so unlike the actual reads (`drainSlices`
 * below) this recursion stays plain sequential: a `$count` answers in under a second (module
 * header), so it is never the pipeline's bottleneck, and a sequential walk cannot deadlock.
 */
async function planSlices(
  deps: SyncDeps,
  scope: SliceScope,
  bounds: SliceBounds,
  pageSize: number,
  tally: Tally | undefined,
  out: SliceBounds[],
): Promise<void> {
  const total = await countOf(deps, buildSliceCountQuery(deps.serviceRoot, scope, bounds), tally);
  if (total === 0) {
    return;
  }
  if (total < pageSize) {
    out.push(bounds);
    return;
  }
  const splitTarget = Math.max(1, Math.round(pageSize * SPLIT_TARGET_SHARE));
  const parts = Math.min(MAX_SPLIT, Math.max(2, Math.ceil(total / splitTarget)));
  const byTime = bounds.keyAfter === undefined && bounds.keyUntil === undefined;
  const children =
    byTime && Date.parse(bounds.until) - Date.parse(bounds.from) > MIN_WINDOW_MS
      ? splitWindow(bounds.from, bounds.until, parts)
      : splitKeys(bounds, parts, pageSize);
  for (const child of children) {
    await planSlices(deps, scope, child, pageSize, tally, out);
  }
}

/** A planned leaf's fetch outcome: its records, or a signal that it grew past one page. */
type LeafFetch =
  | { readonly kind: 'records'; readonly records: readonly Record<string, unknown>[] }
  | { readonly kind: 'grown' };

async function fetchLeaf(
  deps: SyncDeps,
  scope: SliceScope,
  bounds: SliceBounds,
  select: readonly string[],
  ordered: boolean,
  pageSize: number,
  tally: Tally | undefined,
): Promise<LeafFetch> {
  const page = await deps.fetchPage(
    buildSliceQuery(deps.serviceRoot, scope, bounds, { top: pageSize, select, ordered }),
  );
  if (tally !== undefined) tally.requests += 1;
  // A full page means the slice grew after the count, and `$top` cut it.
  return page.records.length < pageSize
    ? { kind: 'records', records: page.records }
    : { kind: 'grown' };
}

/**
 * Reads every record in `scope` within `bounds`, in slices of at most one page, oldest window
 * first. `onSlice` sees each non-empty slice once, with its bounds. Every `onSlice` call is
 * STARTED in `leaves` order, whatever order the fetches or applies actually finish in (#359) — a
 * caller that needs its own work sequenced (a per-slice checkpoint) does so itself, with its own
 * ordering primitive (`runBackfill` uses `Sequencer`), because `onSlice` calls here can be, and
 * normally are, in flight at the same time.
 *
 * Three phases. `planSlices` first finds every leaf, in order (#348). Then a bounded prefetch
 * reads them: up to `deps.concurrency` leaves fetch at once, and at most that many slices' worth
 * of fetched data are ever held in memory unapplied. Then a bounded apply pool runs `onSlice`, up
 * to `deps.applyConcurrency` at once (#359) — that is the actual write-path bottleneck, and the
 * reason this second bound exists apart from the fetch one. A leaf that grew past one page since
 * it was counted is re-drained, recursively — the apply pool is flushed first, because the
 * recursive call reuses `onSlice` and must not interleave with the pool's own bound.
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
  const pageSize = deps.pageSize ?? PAGE_SIZE;
  const leaves: SliceBounds[] = [];
  await planSlices(deps, scope, bounds, pageSize, tally, leaves);
  if (leaves.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.min(deps.concurrency ?? leaves.length, leaves.length));
  const applyConcurrency = Math.max(1, deps.applyConcurrency ?? 1);
  const results = new Map<number, LeafFetch>();
  let firstError: unknown;
  let hasError = false;
  const fail = (error: unknown): void => {
    if (!hasError) {
      hasError = true;
      firstError = error;
    }
  };
  let wake: (() => void) | null = null;
  const notify = (): void => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  const waitForArrival = (): Promise<void> => new Promise((resolve) => (wake = resolve));

  const startFetch = (index: number): void => {
    const leafBounds = leaves[index] as SliceBounds;
    fetchLeaf(deps, scope, leafBounds, select, ordered, pageSize, tally)
      .then((result) => results.set(index, result))
      .catch(fail)
      .finally(notify);
  };

  let nextToFetch = Math.min(concurrency, leaves.length);
  for (let i = 0; i < nextToFetch; i += 1) {
    startFetch(i);
  }
  // Advanced only once a leaf's OWN apply has settled (not merely started, see `runApply` below),
  // so at most `concurrency` slices' worth of data are ever fetched-but-not-yet-applied at once —
  // the same bound as before #359, now measured against completion rather than a single sequential
  // `await`, since several applies can be genuinely in flight together.
  const advanceFetchWindow = (): void => {
    if (nextToFetch < leaves.length) {
      startFetch(nextToFetch);
      nextToFetch += 1;
    }
  };

  // Applies in flight, each wrapped so it never rejects — a failure is recorded via `fail` instead,
  // so `Promise.all`/`Promise.race` over this set never throws and the pool stays a plain bound.
  const applying = new Set<Promise<void>>();
  const runApply = (records: readonly Record<string, unknown>[], leafBounds: SliceBounds): void => {
    const settled: Promise<void> = onSlice(records, leafBounds)
      .catch(fail)
      .finally(() => {
        applying.delete(settled);
        advanceFetchWindow();
      });
    applying.add(settled);
  };
  const waitForApplySlot = async (): Promise<void> => {
    while (applying.size >= applyConcurrency) {
      await Promise.race(applying);
    }
  };

  for (let index = 0; index < leaves.length; index += 1) {
    while (!results.has(index) && !hasError) {
      await waitForArrival();
    }
    if (hasError) break;
    const result = results.get(index) as LeafFetch;
    results.delete(index);
    const leafBounds = leaves[index] as SliceBounds;
    if (result.kind === 'grown') {
      // A rare re-split (#348): flush the pool so the recursive drain's own `onSlice` calls stay
      // within `applyConcurrency` and start strictly after every leaf ahead of this one.
      await Promise.all(applying);
      if (hasError) break;
      await drainSlices(deps, scope, leafBounds, select, onSlice, tally, ordered).catch(fail);
      if (hasError) break;
      advanceFetchWindow();
    } else if (result.records.length > 0) {
      await waitForApplySlot();
      if (hasError) break;
      runApply(result.records, leafBounds);
    } else {
      // An empty slice has nothing to apply, so it settles instantly.
      advanceFetchWindow();
    }
  }

  await Promise.all(applying);
  if (hasError) {
    throw firstError;
  }
}

/**
 * Commits checkpoint writes in call order, even though the work deciding what to write (an
 * `applyPage` transaction) finishes out of order under concurrent apply (#359).
 *
 * `reserve()` grabs a place in line synchronously, before its caller awaits anything, so the order
 * calls arrive in IS the order tickets queue in — call order, not completion order. `commit()` then
 * waits its own turn and only writes when no earlier ticket has failed; once one has, every later
 * ticket skips its write instead of persisting a checkpoint past a slice that never committed. A
 * failed ticket still releases its turn (`fail()`), so a later one is never left waiting forever.
 */
class Sequencer {
  private tail: Promise<void> = Promise.resolve();
  private failed = false;

  reserve(): { commit: (write: () => Promise<void>) => Promise<void>; fail: () => void } {
    const turn = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    return {
      commit: async (write) => {
        await turn;
        try {
          if (!this.failed) {
            await write();
          }
        } catch (error) {
          this.failed = true;
          throw error;
        } finally {
          // Always releases, success or failure: a wedged ticket blocks every later `await turn`
          // forever, and this queue has no other way to notice a stuck one.
          release();
        }
      },
      fail: () => {
        this.failed = true;
        release();
      },
    };
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
 * Per status, every record modified in `(EPOCH, now]`, in `$count`-sized slices, oldest first.
 * Slices apply concurrently, up to `deps.applyConcurrency` (#359), on separate pool connections;
 * `Sequencer` still writes the checkpoint in slice order, only once a slice's own `applyPage`
 * transaction has committed AND every earlier slice's checkpoint write already happened — so a
 * restart always resumes right after the last slice that is actually, contiguously, in the
 * database, never past one still in flight or one that failed. A restart re-reads and re-applies
 * any later slice that had already committed data but not yet its checkpoint; that is extra work,
 * not lost or duplicate data, because the upserts underneath `applyPage` are idempotent.
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
    const sequencer = new Sequencer();

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
        const ticket = stream === null ? null : sequencer.reserve();
        try {
          const result = await deps.applyPage(records);
          tally.add(status, result);
          await deps.progress(tally.snapshot(), { status, through });
          if (ticket !== null) {
            const state: BackfillState = { through, complete: false };
            await ticket.commit(() => deps.writeState(stream as string, state));
          }
        } catch (error) {
          // Whatever failed — the apply itself, recording progress, or the checkpoint write —
          // this ticket must still release its turn, or every later slice's `commit()` waits on
          // it forever (#359).
          ticket?.fail();
          throw error;
        }
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
      tally.add('changes', await deps.applyPage(records));
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
  const tally = new Tally();

  for (const status of options.statuses) {
    const expected = await countOf(
      deps,
      buildCountQuery({ serviceRoot: deps.serviceRoot, status }),
      tally,
    );
    let read = 0;
    await drainSlices(
      deps,
      { status },
      { from: EPOCH, until },
      ['ListingKey'],
      async (records) => {
        for (const record of records) live.add(listingKeyOf(record));
        read += records.length;
      },
      tally,
    );
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
    brightRequests: tally.requests,
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
