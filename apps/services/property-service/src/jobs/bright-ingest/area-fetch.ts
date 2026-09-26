import { type BrightPageOptions, fetchPage, type TokenProvider } from './bright-client';
import type { BrightFeedTier } from './config';
import { buildAreaQuery } from './odata-query';
import type { BrightStagingStore, StagedRecord } from './staging-store';

/**
 * On-demand load of one area's ONE Bright `StandardStatus` pass into staging.
 *
 * Called when a search for a city or ZIP needs more coverage (`src/listings/on-demand.ts`). The
 * scheduled job replicates by `ModificationTimestamp`, which on the production feed scans the whole
 * feed and did not return a 1000-record page within 120 seconds (2026-09-22). An area query filters
 * to one place and one status, so Bright answers from a small match set.
 *
 * Bright rejects `OR` in `$filter` (see `odata-query.ts`), so a load that covers every publicly
 * searchable status (#330) cannot ask for them in one query. This module fetches exactly one
 * status per call; `on-demand.ts` drives the loop across statuses and persists per-status coverage
 * (`bright_area_sync`, #329) between calls, so each status resumes from its own cursor and a large
 * `Closed` (sold) backlog cannot consume the cap a `city=Frederick` search needs for the statuses
 * that keep a listing on the market.
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
  /** Bright `StandardStatus` wire value this call fetches. */
  readonly status: string;
  /** Resume cursor for this status's keyset pass; `null` starts it over. */
  readonly afterKey: string | null;
  readonly pageSize: number;
  /** Stop after this many NEW records, so one call cannot pull an unbounded backlog. */
  readonly maxRecords: number;
  readonly pageOptions?: BrightPageOptions;
  /** Bounds the pass to records changed since this instant (#331 scheduled refresh). */
  readonly modifiedAfter?: string;
  /** Pairs with `modifiedAfter`; closes the window at this instant (#331). */
  readonly modifiedUntil?: string;
}

export interface AreaFetchResult {
  readonly listingKeys: readonly string[];
  readonly pagesFetched: number;
  /** True when this status's pass read to its end before the record cap was reached. */
  readonly complete: boolean;
  /** The cursor to resume from next time; `null` once `complete` is true. */
  readonly afterKey: string | null;
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
  let pagesFetched = 0;
  let afterKey = params.afterKey;

  while (listingKeys.length < params.maxRecords) {
    const url = buildAreaQuery({
      serviceRoot: params.serviceRoot,
      ...(params.city === undefined ? {} : { city: params.city }),
      ...(params.state === undefined ? {} : { state: params.state }),
      ...(params.zip === undefined ? {} : { zip: params.zip }),
      status: params.status,
      afterKey,
      top: params.pageSize,
      ...(params.modifiedAfter === undefined ? {} : { modifiedAfter: params.modifiedAfter }),
      ...(params.modifiedUntil === undefined ? {} : { modifiedUntil: params.modifiedUntil }),
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
      return { listingKeys, pagesFetched, complete: true, afterKey: null };
    }
    afterKey = last.recordKey;
  }

  return { listingKeys, pagesFetched, complete: false, afterKey };
}
