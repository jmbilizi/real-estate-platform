import { type BrightPageOptions, fetchPage, type TokenProvider } from './bright-client';
import type { BrightFeedTier } from './config';
import { buildAreaQuery } from './odata-query';
import type { BrightStagingStore, StagedRecord } from './staging-store';

/**
 * On-demand load of one area's ACTIVE listings into staging.
 *
 * Called when a search for a city or ZIP finds nothing locally (`src/listings/on-demand.ts`). The
 * scheduled job replicates by `ModificationTimestamp`, which on the production feed scans the whole
 * feed and did not return a 1000-record page within 120 seconds (2026-09-22). An area query filters
 * to one place and one status, so Bright answers from a small match set.
 *
 * Staging only, like the rest of this directory. The caller maps the returned keys.
 */

export interface AreaFetchParams {
  readonly serviceRoot: string;
  readonly serviceRootHost: string;
  readonly tokenProvider: TokenProvider;
  readonly store: BrightStagingStore;
  readonly runId: string;
  /** Scopes the staged rows to this run's tier (#314). */
  readonly feedTier: BrightFeedTier;
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
  readonly pageSize: number;
  /** Stop after this many records, so one search cannot pull a whole region. */
  readonly maxRecords: number;
  readonly pageOptions?: BrightPageOptions;
}

export interface AreaFetchResult {
  readonly listingKeys: readonly string[];
  readonly pagesFetched: number;
  /** True when the area has no more active listings than were read. */
  readonly complete: boolean;
}

function toStaged(record: Record<string, unknown>): StagedRecord | null {
  const key = record.ListingKey;
  const listingKey =
    typeof key === 'number' && Number.isSafeInteger(key)
      ? String(key)
      : typeof key === 'string' && /^\d+$/.test(key)
        ? key
        : null;
  const modified = record.ModificationTimestamp;
  const parsed = typeof modified === 'string' ? new Date(modified) : null;
  if (listingKey === null || parsed === null || Number.isNaN(parsed.getTime())) {
    return null;
  }
  return { recordKey: listingKey, modifiedAt: parsed.toISOString(), payload: record };
}

export async function fetchAreaListings(params: AreaFetchParams): Promise<AreaFetchResult> {
  const listingKeys: string[] = [];
  let afterKey: string | null = null;
  let pagesFetched = 0;

  while (listingKeys.length < params.maxRecords) {
    const url = buildAreaQuery({
      serviceRoot: params.serviceRoot,
      ...(params.city === undefined ? {} : { city: params.city }),
      ...(params.state === undefined ? {} : { state: params.state }),
      ...(params.zip === undefined ? {} : { zip: params.zip }),
      afterKey,
      top: params.pageSize,
    });
    const page = await fetchPage(
      url,
      params.tokenProvider,
      params.serviceRootHost,
      params.pageOptions,
    );
    pagesFetched += 1;

    const staged = page.records
      .map(toStaged)
      .filter((record): record is StagedRecord => record !== null);
    if (staged.length > 0) {
      await params.store.stageRecords({
        resource: 'BrightProperties',
        feedTier: params.feedTier,
        runId: params.runId,
        records: staged,
      });
      listingKeys.push(...staged.map((record) => record.recordKey));
    }

    const last = staged[staged.length - 1];
    if (page.records.length < params.pageSize || last === undefined) {
      return { listingKeys, pagesFetched, complete: true };
    }
    afterKey = last.recordKey;
  }

  return { listingKeys, pagesFetched, complete: false };
}
