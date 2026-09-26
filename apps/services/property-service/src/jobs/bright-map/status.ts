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
 * The Bright `StandardStatus` payload values an area load must fetch (#330).
 *
 * `is_publicly_searchable` is the search-display gate. A terminal status (`Closed`) is left out:
 * Bright holds about 5 M sold records, and an area load must never page through them (#337). A
 * status with no `reso_standard_status`, or one that duplicates another, is skipped: Bright takes
 * one value per pass, and a duplicate would run the same query twice.
 */
export function searchableStatuses(statuses: readonly ListingStatusLookup[]): string[] {
  const seen = new Set<string>();
  for (const status of statuses) {
    if (status.isPubliclySearchable && !status.isTerminal && status.resoStandardStatus !== null) {
      seen.add(status.resoStandardStatus);
    }
  }
  return [...seen];
}

/**
 * Bright `$filter` labels, keyed by the `StandardStatus` payload value a record carries (#337).
 *
 * The two vocabularies differ. A record returns `ComingSoon`; a `$filter` must say
 * `StandardStatus eq 'Coming Soon'`. The compact form in a filter is a 400 syntax error. Measured
 * against production Bright on 2026-09-26. `reso_standard_status` holds the payload values
 * (migration 021), so the mapper matches records by that column and a query builder translates
 * through this table.
 */
export const BRIGHT_STATUS_FILTER_LABELS: Readonly<Record<string, string>> = {
  Active: 'Active',
  ComingSoon: 'Coming Soon',
  ActiveUnderContract: 'Active Under Contract',
  Pending: 'Pending',
  Closed: 'Closed',
};

/** The `$filter` label for a payload value. Throws on a value with no measured label. */
export function brightStatusFilterLabel(payloadValue: string): string {
  const label = BRIGHT_STATUS_FILTER_LABELS[payloadValue];
  if (label === undefined) {
    throw new Error(
      `No Bright $filter label is recorded for StandardStatus "${payloadValue}". Probe the label ` +
        'against Bright and add it to BRIGHT_STATUS_FILTER_LABELS.',
    );
  }
  return label;
}
