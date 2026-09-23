import {
  type BrightPageOptions,
  BrightRequestError,
  fetchPage,
  type TokenProvider,
} from './bright-client';
import type { BrightStagingStore, StagedRecord } from './staging-store';

/**
 * Per-listing photo gallery fetch into staging.
 *
 * The #191 crawl reads the whole `BrightMedia` resource, because the test tier refused every
 * `$filter` on it. On the production feed that is millions of rows, so a listing waits hours for
 * its photos. This asks Bright for ONE listing's media instead, filtered on the listing it belongs
 * to, and stages the result for `mapStagedBrightMedia` (`../bright-map/run.ts`).
 *
 * Filters are tried in order: `ResourceRecordKey` as Int64, the same key as a string literal,
 * `ListingSourceRecordKey` (string) and `ListingId` (string). A filter Bright answers 400 is dropped for the life of the
 * process, so a refused shape costs one request, not one per listing. If both are refused the
 * result says so and the caller keeps the listing's `ListPictureURL` photo.
 */

export type MediaFilter =
  | 'ResourceRecordKey'
  | 'ResourceRecordKeyText'
  | 'ListingSourceRecordKey'
  | 'ListingId';

const FILTERS: readonly MediaFilter[] = [
  'ResourceRecordKey',
  'ResourceRecordKeyText',
  'ListingSourceRecordKey',
  'ListingId',
];

/** A gallery is at most a few hundred photos. A nextLink loop past this is a feed fault. */
const MAX_PAGES_PER_LISTING = 10;

/** Filters Bright refused in this process. Module state on purpose: see the header. */
const refused = new Set<MediaFilter>();

export interface ListingMediaTarget {
  readonly listingKey: string;
  readonly listingId: string | null;
}

export interface ListingMediaFetchParams {
  readonly serviceRoot: string;
  readonly serviceRootHost: string;
  readonly tokenProvider: TokenProvider;
  readonly store: BrightStagingStore;
  readonly runId: string;
  readonly listing: ListingMediaTarget;
  readonly pageOptions?: BrightPageOptions;
}

export type ListingMediaFetchResult =
  | { readonly kind: 'staged'; readonly filter: MediaFilter; readonly photos: number }
  | { readonly kind: 'unsupported' };

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildListingMediaFilter(
  filter: MediaFilter,
  listing: ListingMediaTarget,
): string | null {
  if (filter === 'ResourceRecordKey') {
    return /^\d+$/.test(listing.listingKey) ? `ResourceRecordKey eq ${listing.listingKey}` : null;
  }
  // The same key as a string literal. The test tier answered the Int64 form with a Boolean/Int64
  // type error, which reads like a parser that mistypes a bare number.
  if (filter === 'ResourceRecordKeyText') {
    return `ResourceRecordKey eq ${quote(listing.listingKey)}`;
  }
  if (filter === 'ListingSourceRecordKey') {
    return `ListingSourceRecordKey eq ${quote(listing.listingKey)}`;
  }
  return listing.listingId === null ? null : `ListingId eq ${quote(listing.listingId)}`;
}

/**
 * Spaces are sent as `%20`, never `+`. `URLSearchParams` writes `+`, which `BrightProperties`
 * decodes, but `BrightMedia` answered every `+`-encoded filter with a Boolean/<field type> mismatch
 * (2026-09-23) — the shape a parser produces when it reads `+` as a literal operator.
 */
export function buildListingMediaUrl(serviceRoot: string, filter: string): string {
  return `${serviceRoot.replace(/\/+$/, '')}/BrightMedia?$filter=${encodeURIComponent(filter)}`;
}

function toStaged(record: Record<string, unknown>): StagedRecord | null {
  const key = record.MediaKey;
  const recordKey =
    typeof key === 'number' && Number.isSafeInteger(key)
      ? String(key)
      : typeof key === 'string' && key.length > 0
        ? key
        : null;
  if (recordKey === null) {
    return null;
  }
  const modified = record.MediaModificationTimestamp;
  const parsed = typeof modified === 'string' ? new Date(modified) : null;
  const modifiedAt =
    parsed !== null && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date(0).toISOString();
  return { recordKey, modifiedAt, payload: record };
}

export async function fetchListingMedia(
  params: ListingMediaFetchParams,
  onRefused?: (filter: MediaFilter, odataMessage: string | null) => void,
): Promise<ListingMediaFetchResult> {
  for (const filter of FILTERS) {
    if (refused.has(filter)) {
      continue;
    }
    const expression = buildListingMediaFilter(filter, params.listing);
    if (expression === null) {
      continue;
    }

    const records: Record<string, unknown>[] = [];
    let next: string | null = buildListingMediaUrl(params.serviceRoot, expression);
    try {
      for (let page = 0; next !== null && page < MAX_PAGES_PER_LISTING; page += 1) {
        const result = await fetchPage(
          next,
          params.tokenProvider,
          params.serviceRootHost,
          params.pageOptions,
        );
        records.push(...result.records);
        next = result.nextLink;
      }
    } catch (error) {
      if (error instanceof BrightRequestError && error.status === 400) {
        refused.add(filter);
        onRefused?.(filter, error.odataMessage);
        continue;
      }
      throw error;
    }

    const staged = records
      .map(toStaged)
      .filter((record): record is StagedRecord => record !== null);
    await params.store.replaceStagedListingMedia({
      listingKey: params.listing.listingKey,
      runId: params.runId,
      records: staged,
    });
    return { kind: 'staged', filter, photos: staged.length };
  }
  return { kind: 'unsupported' };
}

/** Test seam: forget refused filters between cases. */
export function resetRefusedMediaFilters(): void {
  refused.clear();
}
