/**
 * Incremental replication of one Bright resource into staging (#92).
 *
 * ## The loop
 *
 * Read the persisted cursor, build ONE bounded ordered query from it (`odata-query.ts` is the only
 * module allowed to write `$orderby`, and it always writes the matching `$filter`), then follow
 * `@odata.nextLink` until the feed runs out or the page cap stops the run.
 *
 * ## Why the cursor advances per page and not per run
 *
 * A run is bounded by `maxPagesPerRun` and by the CronJob's 900-second deadline. If the cursor only
 * moved at the end, every capped or killed run would throw away everything it fetched and the next
 * run would fetch it again — a backfill that cannot finish because it restarts. Advancing per page,
 * inside the same transaction that writes that page's rows, makes a run resumable at page
 * granularity. The AC "a re-run after a mid-run failure resumes without missing or duplicating
 * records" is that transaction plus the `(resource, record_key)` primary key, not a claim in prose.
 *
 * ## Ties, and why the page cap is conditional
 *
 * Bright rejects the OR that a strict `(instant, key)` resume needs, so the filter is inclusive —
 * `cursorField ge t` — and the records sharing the watermark instant are read again next pass. The
 * staging upsert makes that free.
 *
 * It is not free if a tie block is wider than the page cap. Then every run reads the same first N
 * pages of one instant, writes the same rows, and stops with the cursor where it started. That is
 * starvation, not slowness, and no amount of waiting fixes it.
 *
 * So the page cap only applies once the pass has moved off the instant it started from. While the
 * cursor instant is unchanged the pass keeps reading, bounded by `HARD_PAGE_CAP_MULTIPLIER` so a run
 * still cannot run forever. A pass that hits the hard cap without advancing reports `starved`, which
 * is a real fault and says so rather than looking like a quiet success.
 *
 * ## Explicit page size
 *
 * On the production feed a 1000-record page of 931 fields did not return within 120 seconds
 * (2026-09-22). With `pageSize` set, each request carries `$top=pageSize`. `$top` suppresses
 * `@odata.nextLink`, so the next request is built from the cursor instead, and a page shorter than
 * `$top` means the feed is caught up. A full page whose records all share the cursor instant would
 * re-read itself forever, so the next request doubles `$top` (up to `MAX_PAGE_SIZE`) until the
 * cursor moves; a full `MAX_PAGE_SIZE` page that still does not move it reports `starved`.
 */

import { type BrightPageOptions, fetchPage, type TokenProvider } from './bright-client';
import type { BrightFeedTier } from './config';
import { buildCursorQuery } from './odata-query';
import type { BrightResource } from './resources';
import type { BrightStagingStore, ReplicationCursor, StagedRecord } from './staging-store';

export interface ReplicateResourceParams {
  readonly resource: BrightResource;
  readonly serviceRoot: string;
  readonly serviceRootHost: string;
  readonly tokenProvider: TokenProvider;
  readonly store: BrightStagingStore;
  readonly runId: string;
  /** Scopes the cursor read/write and the staged rows to this run's tier (#314). */
  readonly feedTier: BrightFeedTier;
  /** Where a pass starts when the stored cursor is empty. */
  readonly initialCursor: string;
  readonly maxPagesPerRun: number;
  /**
   * Records per request, sent as `$top`. Absent means Bright's own 1000-record pages followed by
   * `@odata.nextLink`. See "Explicit page size" in the header.
   */
  readonly pageSize?: number;
  /**
   * Epoch ms after which no further page is requested. The pass stops as if page-capped, so the
   * run reaches mapping inside the CronJob deadline even when every page takes minutes.
   */
  readonly deadlineAt?: number;
  readonly pageOptions?: BrightPageOptions;
  readonly now?: () => Date;
}

/** The largest `$top` a tie block can grow a request to. Bright's own page size. */
export const MAX_PAGE_SIZE = 1000;

/**
 * How far past the page cap a pass may go while the cursor instant has not advanced.
 *
 * The cap exists to bound a run's cost. The multiplier exists so a tie block wider than the cap is
 * crossed instead of re-read forever. Both are needed; neither alone is safe.
 */
export const HARD_PAGE_CAP_MULTIPLIER = 20;

/**
 * A pass that failed part way, carrying what it had already done.
 *
 * The cursor advances inside the transaction that writes each page, so a pass that staged 40,000
 * rows and then met a 500 has really moved. Throwing a bare error would drop that from the run
 * report, and the next run would look like it had skipped the work.
 */
export class ReplicationFailure extends Error {
  readonly partial: ReplicateResourceResult;
  /** The original error. Named `reason` rather than `cause`, which needs a newer lib target. */
  readonly reason: unknown;

  constructor(reason: unknown, partial: ReplicateResourceResult) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = 'ReplicationFailure';
    this.reason = reason;
    this.partial = partial;
  }
}

export interface ReplicateResourceResult {
  readonly resource: string;
  readonly kind: BrightResource['kind'];
  readonly pagesFetched: number;
  readonly recordsFetched: number;
  readonly recordsStaged: number;
  readonly retries: number;
  readonly cursorBefore: ReplicationCursor;
  readonly cursorAfter: ReplicationCursor;
  /** Hours between the resulting cursor instant and now. `null` before the first record. */
  readonly cursorAgeHours: number | null;
  /** True when the pass reached the end of the feed. */
  readonly caughtUp: boolean;
  /** True when the page cap stopped the pass with more to read. */
  readonly cappedByPageLimit: boolean;
  /**
   * True when the pass read `maxPagesPerRun * HARD_PAGE_CAP_MULTIPLIER` pages without the cursor
   * instant advancing. A tie block wider than that cannot be crossed, so every later run repeats
   * this one. It is a fault, not a slow backfill.
   */
  readonly starved: boolean;
}

/**
 * Reads the resource's key as text.
 *
 * Every Bright key is `Edm.Int64` and therefore arrives as a JSON number. Above 2^53 a JSON number
 * is not the integer Bright sent, and this value becomes a staging primary key and a cursor
 * tiebreak — so a silently rounded key would merge two records into one row and could make the
 * resume predicate skip the block around it. The range check is cheap and the failure is loud.
 */
function readKey(record: Record<string, unknown>, resource: BrightResource): string {
  const raw = record[resource.keyField];
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      throw new Error(
        `${resource.entitySet}.${resource.keyField} arrived as ${raw}, which is outside the exact ` +
          'integer range of a JSON number. The key would be rounded, and it is the staging primary ' +
          'key and the cursor tiebreak.',
      );
    }
    return String(raw);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  throw new Error(
    `${resource.entitySet} record has no usable ${resource.keyField}. It is declared non-nullable ` +
      'in the committed $metadata document.',
  );
}

function readCursorInstant(record: Record<string, unknown>, resource: BrightResource): string {
  const raw = record[resource.cursorField];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      `${resource.entitySet} record has no ${resource.cursorField}. The query filters and orders ` +
        'on that field, so the feed cannot return a record without one. Treat this as a feed ' +
        'schema change, not a record to skip.',
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `${resource.entitySet}.${resource.cursorField} is not a valid instant: "${raw}".`,
    );
  }
  return parsed.toISOString();
}

/** Runs one resource to the page cap or to the end of the feed. */
export async function replicateResource(
  params: ReplicateResourceParams,
): Promise<ReplicateResourceResult> {
  const { resource, store, runId, feedTier } = params;
  const now = params.now ?? (() => new Date());

  const cursorBefore = await store.readCursor(resource.entitySet, feedTier);
  let cursor: ReplicationCursor = cursorBefore;

  let retries = 0;
  const pageOptions: BrightPageOptions = {
    ...params.pageOptions,
    onRetry: (attempt, status) => {
      retries += 1;
      params.pageOptions?.onRetry?.(attempt, status);
    },
  };

  // The instant this pass starts from. The page cap is not applied until the cursor moves past it.
  const startInstant = cursor.modifiedAt ?? params.initialCursor;

  let top = params.pageSize;
  const queryFrom = (modifiedAt: string, recordKey: string | null): string =>
    buildCursorQuery({
      serviceRoot: params.serviceRoot,
      resource,
      cursor: { modifiedAt, recordKey },
      ...(top === undefined ? {} : { top }),
    });

  let url: string | null = queryFrom(startInstant, cursor.recordKey);

  const hardCap = params.maxPagesPerRun * HARD_PAGE_CAP_MULTIPLIER;
  let pagesFetched = 0;
  let recordsFetched = 0;
  let recordsStaged = 0;
  let caughtUp = false;
  let cappedByPageLimit = false;
  let starved = false;

  const snapshot = (): ReplicateResourceResult => {
    const ageHours =
      cursor.modifiedAt === null
        ? null
        : Math.max(0, (now().getTime() - new Date(cursor.modifiedAt).getTime()) / 3_600_000);
    return {
      resource: resource.entitySet,
      kind: resource.kind,
      pagesFetched,
      recordsFetched,
      recordsStaged,
      retries,
      cursorBefore,
      cursorAfter: cursor,
      cursorAgeHours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
      caughtUp,
      cappedByPageLimit,
      starved,
    };
  };

  try {
    while (url !== null) {
      if (
        pagesFetched > 0 &&
        params.deadlineAt !== undefined &&
        now().getTime() >= params.deadlineAt
      ) {
        cappedByPageLimit = true;
        break;
      }
      const page = await fetchPage(url, params.tokenProvider, params.serviceRootHost, pageOptions);
      pagesFetched += 1;
      recordsFetched += page.records.length;
      const instantBeforePage = cursor.modifiedAt ?? startInstant;

      const staged: StagedRecord[] = page.records.map((record) => ({
        recordKey: readKey(record, resource),
        modifiedAt: readCursorInstant(record, resource),
        payload: record,
      }));

      // Ordered ascending by (cursorField, keyField), so the last record is the high-water mark. The
      // cursor is left untouched by an empty page: advancing it to "now" would skip anything Bright
      // had not yet made visible at that instant.
      const last = staged[staged.length - 1];
      if (last !== undefined) {
        cursor = { modifiedAt: last.modifiedAt, recordKey: last.recordKey };
      }

      recordsStaged += await store.commitBatch({
        resource: resource.entitySet,
        feedTier,
        runId,
        records: staged,
        cursor,
      });

      const advanced = cursor.modifiedAt !== null && cursor.modifiedAt !== startInstant;

      if (top !== undefined) {
        // Explicit page size: `$top` suppresses nextLink, so page by re-querying from the cursor.
        const movedThisPage = cursor.modifiedAt !== instantBeforePage;
        if (page.records.length < top) {
          caughtUp = true;
          url = null;
        } else if (!movedThisPage && top >= MAX_PAGE_SIZE) {
          starved = true;
          cappedByPageLimit = true;
          url = null;
        } else if (pagesFetched >= params.maxPagesPerRun && advanced) {
          cappedByPageLimit = true;
          url = null;
        } else if (pagesFetched >= hardCap) {
          starved = !advanced;
          cappedByPageLimit = true;
          url = null;
        } else {
          // A full page that did not move the cursor is one tie block: widen the next request.
          top = movedThisPage ? (params.pageSize as number) : Math.min(top * 2, MAX_PAGE_SIZE);
          url = queryFrom(cursor.modifiedAt ?? startInstant, cursor.recordKey);
        }
      } else if (page.nextLink === null) {
        caughtUp = true;
        url = null;
      } else if (pagesFetched >= params.maxPagesPerRun && advanced) {
        cappedByPageLimit = true;
        url = null;
      } else if (pagesFetched >= hardCap) {
        // Past the cap and still on the instant this pass started from: the tie block is wider than
        // the run can cross, so every later run would repeat exactly this.
        starved = !advanced;
        cappedByPageLimit = true;
        url = null;
      } else {
        url = page.nextLink;
      }
    }
  } catch (error) {
    throw new ReplicationFailure(error, snapshot());
  }

  return snapshot();
}
