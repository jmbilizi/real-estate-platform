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
 * ## Ties
 *
 * The cursor is a pair, `(modified_at, record_key)`, and the resume predicate is strict on that
 * pair. See `odata-query.ts` for why a timestamp alone starves a capped run on a tie block rather
 * than merely repeating work.
 */

import { type BrightPageOptions, fetchPage, type TokenProvider } from './bright-client';
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
  /** Where a pass starts when the stored cursor is empty. */
  readonly initialCursor: string;
  readonly pageSize: number;
  readonly maxPagesPerRun: number;
  readonly pageOptions?: BrightPageOptions;
  readonly now?: () => Date;
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
  const { resource, store, runId } = params;
  const now = params.now ?? (() => new Date());

  const cursorBefore = await store.readCursor(resource.entitySet);
  let cursor: ReplicationCursor = cursorBefore;

  let retries = 0;
  const pageOptions: BrightPageOptions = {
    ...params.pageOptions,
    onRetry: (attempt, status) => {
      retries += 1;
      params.pageOptions?.onRetry?.(attempt, status);
    },
  };

  let url: string | null = buildCursorQuery({
    serviceRoot: params.serviceRoot,
    resource,
    cursor: {
      modifiedAt: cursor.modifiedAt ?? params.initialCursor,
      recordKey: cursor.modifiedAt === null ? null : cursor.recordKey,
    },
    pageSize: params.pageSize,
  });

  let pagesFetched = 0;
  let recordsFetched = 0;
  let recordsStaged = 0;
  let caughtUp = false;
  let cappedByPageLimit = false;

  while (url !== null) {
    const page = await fetchPage(url, params.tokenProvider, params.serviceRootHost, pageOptions);
    pagesFetched += 1;
    recordsFetched += page.records.length;

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
      runId,
      records: staged,
      cursor,
    });

    if (page.nextLink === null) {
      caughtUp = true;
      url = null;
    } else if (pagesFetched >= params.maxPagesPerRun) {
      cappedByPageLimit = true;
      url = null;
    } else {
      url = page.nextLink;
    }
  }

  const cursorAgeHours =
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
    cursorAgeHours: cursorAgeHours === null ? null : Math.round(cursorAgeHours * 100) / 100,
    caughtUp,
    cappedByPageLimit,
  };
}
