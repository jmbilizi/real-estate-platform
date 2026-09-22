/**
 * Full crawl of a Bright resource that has no cursor (#191).
 *
 * `BrightMedia` accepts no `$filter` at all — see `resources.ts`. It can still be read as an
 * unfiltered, unordered scan, so this module reads every row, keeps only the ones whose
 * `ResourceRecordKey` is already staged for `BrightProperties`, and drops the rest.
 *
 * ## The resume mechanism
 *
 * An unfiltered scan carries no timestamp to resume from, so this module persists the raw
 * `@odata.nextLink` itself, in `bright_replication_cursor.cursor_record_key`, with
 * `cursor_modified_at` left `null`. A capped run stores the link and stops; the next run reads it
 * back and resumes from exactly that page. When the feed returns no `@odata.nextLink` the pass is
 * complete, so the stored link is cleared and the next run starts a fresh pass from the top.
 *
 * The link is never reported. It can carry a token, so `nextLinkStored` is a boolean, never the
 * link itself, and no log line or error message in this module includes one.
 */

import { type BrightPageOptions, fetchPage, type TokenProvider } from './bright-client';
import type { BrightResource } from './resources';
import type { BrightStagingStore, ReplicationCursor, StagedRecord } from './staging-store';

export interface CrawlResourceParams {
  readonly resource: BrightResource;
  readonly serviceRoot: string;
  readonly serviceRootHost: string;
  readonly tokenProvider: TokenProvider;
  readonly store: BrightStagingStore;
  readonly runId: string;
  /** A row is staged only when its `ResourceRecordKey`, stringified, is in this set. */
  readonly keepRecordKeys: ReadonlySet<string>;
  readonly maxPagesPerRun: number;
  readonly pageOptions?: BrightPageOptions;
  readonly now?: () => Date;
}

/**
 * A pass that failed part way, carrying what it had already staged.
 *
 * Mirrors `ReplicationFailure` in `replicate.ts`. Each page is staged inside its own transaction, so
 * a pass that matched and staged rows before a later page failed has really made progress, and the
 * run report must say so.
 */
export class CrawlFailure extends Error {
  readonly partial: CrawlResourceResult;
  readonly reason: unknown;

  constructor(reason: unknown, partial: CrawlResourceResult) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = 'CrawlFailure';
    this.reason = reason;
    this.partial = partial;
  }
}

export interface CrawlResourceResult {
  readonly resource: string;
  readonly pagesFetched: number;
  readonly recordsFetched: number;
  /** Records whose `ResourceRecordKey` was in `keepRecordKeys`. A subset of `recordsFetched`. */
  readonly recordsMatched: number;
  readonly recordsStaged: number;
  readonly retries: number;
  /** True when the page cap stopped the pass with more of the feed left to read. */
  readonly cappedByPageLimit: boolean;
  /** True when the feed returned no `@odata.nextLink`, so the whole resource has been scanned. */
  readonly passComplete: boolean;
  /** Whether a resume link is stored for the next run. Never the link itself. */
  readonly nextLinkStored: boolean;
}

/** The bare entity-set URL. No `$filter`, no `$orderby`, no `$top` — the feed rejects the first two. */
function buildCrawlStartUrl(serviceRoot: string, resource: BrightResource): string {
  const base = serviceRoot.replace(/\/+$/, '');
  return `${base}/${resource.entitySet}`;
}

/**
 * Reads `ResourceRecordKey`, stringified.
 *
 * The field is `Edm.Int64` and arrives as a JSON number; the staged `BrightProperties` key is text.
 * `String(value)` normalises both onto the same representation. A record with no usable key is
 * unmatchable by definition, so this returns `null` rather than throwing.
 */
function readResourceRecordKey(record: Record<string, unknown>): string | null {
  const raw = record.ResourceRecordKey;
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'number' || typeof raw === 'string') {
    return String(raw);
  }
  return null;
}

/**
 * Reads the resource's own key as text, for use as the staging `recordKey`.
 *
 * Mirrors `readKey` in `replicate.ts`. Every Bright key is `Edm.Int64`; above 2^53 a JSON number is
 * not the integer Bright sent, and this value becomes the staging primary key.
 */
function readOwnKey(record: Record<string, unknown>, resource: BrightResource): string {
  const raw = record[resource.keyField];
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      throw new Error(
        `${resource.entitySet}.${resource.keyField} arrived as ${raw}, which is outside the exact ` +
          'integer range of a JSON number. The key would be rounded, and it is the staging primary key.',
      );
    }
    return String(raw);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  throw new Error(`${resource.entitySet} record has no usable ${resource.keyField}.`);
}

/** `MediaModificationTimestamp`, else `MediaCreationTimestamp`, else the run's own clock. */
function readModifiedAt(record: Record<string, unknown>, now: () => Date): string {
  for (const field of ['MediaModificationTimestamp', 'MediaCreationTimestamp']) {
    const raw = record[field];
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  return now().toISOString();
}

/** Runs one resource's full crawl to the page cap or to the end of the feed. */
export async function crawlResource(params: CrawlResourceParams): Promise<CrawlResourceResult> {
  const { resource, store, runId, keepRecordKeys } = params;
  const now = params.now ?? (() => new Date());

  if (!resource.supportsFullCrawl) {
    throw new Error(
      `${resource.entitySet} does not support the full-crawl path. See supportsFullCrawl in ` +
        'resources.ts.',
    );
  }

  const cursorBefore: ReplicationCursor = await store.readCursor(resource.entitySet);
  // `recordKey` carries the stored @odata.nextLink for this resource. `null` starts a fresh pass.
  let storedNextLink: string | null = cursorBefore.recordKey;

  let retries = 0;
  const pageOptions: BrightPageOptions = {
    ...params.pageOptions,
    onRetry: (attempt, status) => {
      retries += 1;
      params.pageOptions?.onRetry?.(attempt, status);
    },
  };

  let url: string | null = storedNextLink ?? buildCrawlStartUrl(params.serviceRoot, resource);

  let pagesFetched = 0;
  let recordsFetched = 0;
  let recordsMatched = 0;
  let recordsStaged = 0;
  let cappedByPageLimit = false;
  let passComplete = false;

  const snapshot = (): CrawlResourceResult => ({
    resource: resource.entitySet,
    pagesFetched,
    recordsFetched,
    recordsMatched,
    recordsStaged,
    retries,
    cappedByPageLimit,
    passComplete,
    nextLinkStored: storedNextLink !== null,
  });

  try {
    while (url !== null) {
      const page = await fetchPage(url, params.tokenProvider, params.serviceRootHost, pageOptions);
      pagesFetched += 1;
      recordsFetched += page.records.length;

      const matched = page.records.filter((record) => {
        const resourceRecordKey = readResourceRecordKey(record);
        return resourceRecordKey !== null && keepRecordKeys.has(resourceRecordKey);
      });
      recordsMatched += matched.length;

      const staged: StagedRecord[] = matched.map((record) => ({
        recordKey: readOwnKey(record, resource),
        modifiedAt: readModifiedAt(record, now),
        payload: record,
      }));

      const nextLink = page.nextLink;
      // No timestamp to advance, so the cursor this pass persists IS the resume position: the raw
      // next link, or null once the feed has nothing more to give.
      const cursorAfter: ReplicationCursor = { modifiedAt: null, recordKey: nextLink };

      recordsStaged += await store.commitBatch({
        resource: resource.entitySet,
        runId,
        records: staged,
        cursor: cursorAfter,
      });
      storedNextLink = nextLink;

      if (nextLink === null) {
        passComplete = true;
        url = null;
      } else if (pagesFetched >= params.maxPagesPerRun) {
        cappedByPageLimit = true;
        url = null;
      } else {
        url = nextLink;
      }
    }
  } catch (error) {
    throw new CrawlFailure(error, snapshot());
  }

  return snapshot();
}
