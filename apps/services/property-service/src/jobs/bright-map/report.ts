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
}

export const ZERO_MAP_REPORT: BrightMapRunReport = {
  staged: 0,
  mapped: 0,
  published: 0,
  withheld: 0,
  withheldByReason: {},
  takenDown: 0,
  sampleMarked: 0,
};
