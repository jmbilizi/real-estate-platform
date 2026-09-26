/**
 * Bright `StandardStatus` to the `listing_statuses` vocabulary (#93).
 *
 * Bright's `$metadata` declares no `EnumType`s and the `Lookup` resource 400s for our IDX tier, so
 * `StandardStatus` has no discoverable vocabulary (#33 item 9(a)). `listing_statuses` (migration 003)
 * is therefore the only vocabulary this mapper trusts. A value that is not a `code` or a
 * `reso_standard_status` in that table fails closed: the record is not published, never guessed at.
 */

export interface ListingStatusLookup {
  readonly code: string;
  readonly consumerStatus: 'Active' | 'Pending' | 'Coming Soon' | 'Sold' | null;
  readonly isTerminal: boolean;
  readonly resoStandardStatus: string | null;
  readonly isPubliclySearchable: boolean;
}

export interface StatusMapResult {
  readonly code: string;
  readonly consumerStatus: ListingStatusLookup['consumerStatus'];
  readonly isTerminal: boolean;
}

/** Matches on `code` first, then `reso_standard_status`, so a feed value equal to either resolves. */
export function mapStandardStatus(
  standardStatus: string | null | undefined,
  statuses: readonly ListingStatusLookup[],
): StatusMapResult | null {
  if (typeof standardStatus !== 'string') {
    return null;
  }
  const trimmed = standardStatus.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = statuses.find((s) => s.code === trimmed || s.resoStandardStatus === trimmed);
  if (!match) {
    return null;
  }
  return { code: match.code, consumerStatus: match.consumerStatus, isTerminal: match.isTerminal };
}

/**
 * The Bright `StandardStatus` wire values an area load must fetch (#330).
 *
 * `is_publicly_searchable` is the search-display gate. A status carries no `reso_standard_status`
 * on this feed, or duplicates one another status already reports, is skipped: Bright takes one
 * value per pass, and a duplicate would run the same query twice.
 */
export function searchableStatuses(statuses: readonly ListingStatusLookup[]): string[] {
  const seen = new Set<string>();
  for (const status of statuses) {
    if (status.isPubliclySearchable && status.resoStandardStatus !== null) {
      seen.add(status.resoStandardStatus);
    }
  }
  return [...seen];
}
