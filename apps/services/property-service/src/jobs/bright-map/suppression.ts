/**
 * Seller display suppression mapping (#93, #146).
 *
 * ## The rule (stakeholder ruling 2026-10-08, #146)
 *
 * When the feed marks a value not permitted for public display, the site suppresses it. Three
 * per-record election fields map onto three consumer flags. Each is read the same way:
 *
 *  - Literal `false` suppresses the value.
 *  - Literal `true` shows it.
 *  - Absent or `null` means the seller made no election, so the value shows.
 *  - Any other value (a string, a number) suppresses and counts as an anomaly. A value this mapper
 *    cannot read as a boolean is not an election to show.
 *
 * The ruling reverses the 2026-09-16 hard gate, which fixed price history and days on market to
 * suppressed until Bright supplied the semantics in writing (#33 item 8(f)). It also replaces the
 * 2026-09-23 fixed `priceDisplayAllowed: true`. The broker reviews the live site and requests
 * changes if needed. Zillow, Redfin and Homes.com show price history and days on market for
 * listings with no seller election, and so does this site now.
 *
 * | Consumer value | Bright field                               | Flag                         |
 * | -------------- | ------------------------------------------ | ---------------------------- |
 * | Current price  | `InternetListingDisplayPricesYN`           | `priceDisplayAllowed`        |
 * | Price history  | `InternetListingDisplayHistoricalPricesYN` | `priceHistoryDisplayAllowed` |
 * | Days on market | `InternetListingDisplayDaysOnSiteYN`       | `daysOnMarketDisplayAllowed` |
 * | Each photo     | `MediaInternetDisplayYN` (per media row)   | per-photo gate, `map-media`  |
 *
 * The table is keyed by originating system (PRD section 1). A second MLS adds an entry and no
 * branch.
 *
 * ## The four names are NOT declared in the live `$metadata` (checked 2026-10-08)
 *
 * The ticket asks to confirm the names against `$metadata`. They were not found. The production-tier
 * `$metadata` (HTTP 200, 242,091 bytes) declares none of the four on `BrightProperty` or
 * `BrightMedia`, and no field under another name does the same job. A `$select` that names one
 * answers HTTP 400 (`The property '...' is not defined in type ...`). So:
 *
 *  - The names stay as the ticket states them. The mapping is correct for a record that carries
 *    them. It is inert for every record the feed sends today, so no listing is suppressed by it.
 *  - The fields are NOT in `BRIGHT_SYNC_SELECT`. Adding one fails every sync page. When Bright
 *    declares a field, add it to the select list and remove it from
 *    `UNDECLARED_SUPPRESSION_FIELDS`.
 *
 * Until then a seller election cannot reach this site through the feed. See the #146 comment.
 *
 * ## Fields that stay explicit-true (default deny)
 *
 * `InternetEntireListingDisplayYN` and `InternetAddressDisplayYN` (#33 item 9) keep the old reading.
 * Anything other than the literal `true` withholds the listing or the address. #146 does not change
 * them.
 *
 * ## Media (stakeholder rulings 2026-09-22 #191 and 2026-10-08 #146)
 *
 * `mediaDisplayAllowed` stays fixed true for every Bright row. The stakeholder states that Bright
 * images arrive carrying their trademark or watermark, and that Cribstop holds a licence to display
 * them. The licence is asserted, not written: #33 item 8(c) still owes the terms in writing.
 *
 * The 2026-10-08 ruling adds a per-photo gate. `map-media.ts` skips a media record whose
 * `MediaInternetDisplayYN` is `false`. The feed marks the one retained exterior photo by leaving
 * that flag true on it and false on the others. Honor the flag per record. Do not choose a retained
 * photo with `is_primary` or `sort_order`.
 *
 * `mediaDisplayAllowed` is the LISTING-level gate that `repository.ts` reads as
 * `(v.media_display_allowed OR m.retained_when_suppressed)`. It is not a per-photo permission.
 * `retained_when_suppressed` stays unset by this mapper, because the per-record flag already
 * removes suppressed photos before they reach `listing_media`.
 */

export type SuppressionSource = 'BrightMLS';

export interface SuppressionFieldNames {
  readonly price: string;
  readonly priceHistory: string;
  readonly daysOnMarket: string;
  readonly media: string;
}

/** Election field names per originating system (PRD section 1). */
export const SUPPRESSION_FIELDS_BY_SOURCE: Readonly<
  Record<SuppressionSource, SuppressionFieldNames>
> = {
  BrightMLS: {
    price: 'InternetListingDisplayPricesYN',
    priceHistory: 'InternetListingDisplayHistoricalPricesYN',
    daysOnMarket: 'InternetListingDisplayDaysOnSiteYN',
    media: 'MediaInternetDisplayYN',
  },
};

/**
 * Names the live `$metadata` does not declare (2026-10-08). A `$select` that names one fails with
 * HTTP 400, so `BRIGHT_SYNC_SELECT` must not carry them.
 */
export const UNDECLARED_SUPPRESSION_FIELDS: readonly string[] = Object.freeze(
  Object.values(SUPPRESSION_FIELDS_BY_SOURCE.BrightMLS),
);

/** The flags a per-record election field sets. Counter keys on the run report. */
export type ElectionFlag = 'price' | 'priceHistory' | 'daysOnMarket';

export interface ElectionReading {
  readonly allowed: boolean;
  /** True when the value is neither a boolean nor absent/null. */
  readonly anomaly: boolean;
}

/** Reads one election field by the rule in the header. */
export function readElection(value: unknown): ElectionReading {
  if (value === undefined || value === null) {
    return { allowed: true, anomaly: false };
  }
  if (typeof value === 'boolean') {
    return { allowed: value, anomaly: false };
  }
  return { allowed: false, anomaly: true };
}

export interface SuppressionFlags {
  readonly internetDisplayAllowed: boolean;
  readonly addressDisplayAllowed: boolean;
  readonly priceDisplayAllowed: boolean;
  readonly priceHistoryDisplayAllowed: boolean;
  readonly mediaDisplayAllowed: boolean;
  readonly daysOnMarketDisplayAllowed: boolean;
  /** Election fields that held a non-boolean value. Each one is suppressed. */
  readonly anomalies: readonly ElectionFlag[];
}

function isExplicitlyTrue(value: unknown): boolean {
  return value === true;
}

export function mapSuppressionFlags(
  payload: Readonly<Record<string, unknown>>,
  source: SuppressionSource = 'BrightMLS',
): SuppressionFlags {
  const fields = SUPPRESSION_FIELDS_BY_SOURCE[source];
  const price = readElection(payload[fields.price]);
  const priceHistory = readElection(payload[fields.priceHistory]);
  const daysOnMarket = readElection(payload[fields.daysOnMarket]);
  const anomalies: ElectionFlag[] = [];
  if (price.anomaly) anomalies.push('price');
  if (priceHistory.anomaly) anomalies.push('priceHistory');
  if (daysOnMarket.anomaly) anomalies.push('daysOnMarket');
  return {
    internetDisplayAllowed: isExplicitlyTrue(payload.InternetEntireListingDisplayYN),
    addressDisplayAllowed: isExplicitlyTrue(payload.InternetAddressDisplayYN),
    priceDisplayAllowed: price.allowed,
    priceHistoryDisplayAllowed: priceHistory.allowed,
    // Fixed true by the licence ruling of 2026-09-22. Per-photo suppression is in `map-media.ts`.
    mediaDisplayAllowed: true,
    daysOnMarketDisplayAllowed: daysOnMarket.allowed,
    anomalies,
  };
}
