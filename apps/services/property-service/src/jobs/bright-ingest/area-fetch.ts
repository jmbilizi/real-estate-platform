import { type BrightPageOptions, fetchPage, type TokenProvider } from './bright-client';
import type { BrightFeedTier } from './config';
import { buildAreaQuery } from './odata-query';
import type { BrightStagingStore, StagedRecord } from './staging-store';

/**
 * On-demand load of one area's publicly searchable listings into staging.
 *
 * Called when a search for a city or ZIP finds nothing locally (`src/listings/on-demand.ts`). The
 * scheduled job replicates by `ModificationTimestamp`, which on the production feed scans the whole
 * feed and did not return a 1000-record page within 120 seconds (2026-09-22). An area query filters
 * to one place and one status, so Bright answers from a small match set.
 *
 * Bright rejects `OR` in `$filter` (see `odata-query.ts`), so a load that covers every publicly
 * searchable status (#330) cannot ask for them in one query. `fetchAreaListings` runs one keyset
 * pass per status instead, resetting `afterKey` between statuses. `params.statuses` is the caller's
 * job to derive from `listing_statuses` (`bright-map/status.ts` `searchableStatuses`) — this module
 * only pages the ones it is given.
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
  /** Bright `StandardStatus` wire values to fetch, one keyset pass each. Never empty in practice. */
  readonly statuses: readonly string[];
  readonly pageSize: number;
  /** Stop after this many records total, across every status, so one search cannot pull a region. */
  readonly maxRecords: number;
  readonly pageOptions?: BrightPageOptions;
}

export interface AreaFetchResult {
  readonly listingKeys: readonly string[];
  readonly pagesFetched: number;
  /** True when every status's pass read to its end before the record cap was reached. */
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

/**
 * One status's keyset pass, stopping at the shared `maxRecords` cap. Appends to `listingKeys` in
 * place, so the cap applies across every status a call to `fetchAreaListings` covers.
 */
async function fetchOneStatus(
  params: AreaFetchParams,
  status: string,
  listingKeys: string[],
): Promise<{ pagesFetched: number; complete: boolean }> {
  let afterKey: string | null = null;
  let pagesFetched = 0;

  while (listingKeys.length < params.maxRecords) {
    const url = buildAreaQuery({
      serviceRoot: params.serviceRoot,
      ...(params.city === undefined ? {} : { city: params.city }),
      ...(params.state === undefined ? {} : { state: params.state }),
      ...(params.zip === undefined ? {} : { zip: params.zip }),
      status,
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
      return { pagesFetched, complete: true };
    }
    afterKey = last.recordKey;
  }

  return { pagesFetched, complete: false };
}

export async function fetchAreaListings(params: AreaFetchParams): Promise<AreaFetchResult> {
  const listingKeys: string[] = [];
  let pagesFetched = 0;

  for (const status of params.statuses) {
    if (listingKeys.length >= params.maxRecords) {
      return { listingKeys, pagesFetched, complete: false };
    }
    const pass = await fetchOneStatus(params, status, listingKeys);
    pagesFetched += pass.pagesFetched;
    if (!pass.complete) {
      return { listingKeys, pagesFetched, complete: false };
    }
  }

  return { listingKeys, pagesFetched, complete: true };
}
