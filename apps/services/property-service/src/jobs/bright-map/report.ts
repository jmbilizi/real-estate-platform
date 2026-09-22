/**
 * Per-run reconciliation report for the Bright mapping pass (#93).
 *
 * `staged` is every row read from `bright_staging_records` for the resource this pass worked.
 * `mapped` is how many of those `mapBrightPropertyRecord` accepted; the rest are `withheld`, broken
 * down `byReason` so a fail-closed spike is diagnosable without reading raw payloads. `published` is
 * the subset of mapped rows that are actually visible in `listing_search_v` (internet display
 * allowed and a non-null consumer status) — a mapped row can still be written and not visible, e.g.
 * a Withdrawn status or a seller-suppressed listing. `takenDown` counts mapped rows whose resolved
 * consumer status is null (Withdrawn/Expired/Canceled/Hold), i.e. rows this pass removed from
 * consumer visibility by status alone. `sampleMarked` is a straight count of `is_sample=true` rows
 * this pass wrote — a non-zero count against the production feed is an alarm, per the ticket.
 */

export interface BrightMapRunReport {
  readonly staged: number;
  readonly mapped: number;
  readonly published: number;
  readonly withheld: number;
  readonly withheldByReason: Readonly<Record<string, number>>;
  readonly takenDown: number;
  readonly sampleMarked: number;
  /**
   * Count of mapped records whose named Bright field was dropped to `null` because the value
   * overflowed the `integer` column it maps to (#237) — e.g. a `LotSizeSquareFeet` outside
   * Postgres's `integer` range. The record still publishes; this is a data-quality signal, not a
   * rejection, so it is tracked separately from `withheldByReason`.
   */
  readonly outOfRangeFieldCounts: Readonly<Record<string, number>>;
}

/**
 * Per-run report for the media mapping pass (#191).
 *
 * Separate from `BrightMapRunReport` because the two passes count different things. A media row is
 * not a listing: it is rejected for reasons a property record has no equivalent of, and it can map
 * cleanly and still belong to no listing we hold.
 *
 * `unmatchedMedia` is the one to read first. A crawl stages only media whose `ResourceRecordKey`
 * matches a staged `ListingKey`, so a large count here means the property pass rejected listings
 * the media pass still holds photos for. That is a real signal, not noise.
 *
 * `listingsWithNoMedia` counts Bright listings in `listings` that carry no feed photo AFTER this
 * pass. It is measured against the table, not against the media the pass happened to see, so it
 * can actually report the condition it exists for. A run where it equals the Bright listing count
 * is the #191 defect returning, and it reads as an anomaly rather than as a success.
 */
export interface BrightMediaMapReport {
  readonly staged: number;
  readonly mapped: number;
  readonly rejected: number;
  readonly rejectedByReason: Readonly<Record<string, number>>;
  readonly unmatchedMedia: number;
  readonly listingsWithMedia: number;
  readonly listingsWithNoMedia: number;
  readonly mediaWritten: number;
}

export const ZERO_MEDIA_MAP_REPORT: BrightMediaMapReport = {
  staged: 0,
  mapped: 0,
  rejected: 0,
  rejectedByReason: {},
  unmatchedMedia: 0,
  listingsWithMedia: 0,
  listingsWithNoMedia: 0,
  mediaWritten: 0,
};

export const ZERO_MAP_REPORT: BrightMapRunReport = {
  staged: 0,
  mapped: 0,
  published: 0,
  withheld: 0,
  withheldByReason: {},
  takenDown: 0,
  sampleMarked: 0,
  outOfRangeFieldCounts: {},
};
