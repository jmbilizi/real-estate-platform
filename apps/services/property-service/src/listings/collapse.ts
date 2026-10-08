/**
 * #716. One card per home.
 *
 * The same home can carry several live MLS records: a relist, a stale row, or one home entered under
 * several property types. The collapse runs inside every search query and hides a record when a
 * better record of the same home exists. Nothing is stored. A record that goes off-market stops
 * counting on the next query, so the next live record becomes the card.
 *
 * Two records are the same home only when ALL of these hold:
 *  - same property, unit, listing type (sale or rent) and listing office;
 *  - beds, baths and living area agree when both records carry them (area within 10%);
 *  - the two prices are within 2x of each other and both are visible.
 *
 * The collapse never applies to:
 *  - lots and land. Two parcels can share one address;
 *  - Multi-Family and Condo records that have no unit. Nothing proves they are the same unit;
 *  - a property whose live records name more than one office.
 *
 * The better record has the latest `listed_at`, then the status (Active, Coming Soon, Pending), then
 * the latest `source_modification_timestamp`, then the greater id. The order is total, so the best
 * record of any set has no better sibling. Every home keeps at least one card.
 *
 * Only live records count: a sold, taken-down or suppressed record neither hides nor is hidden.
 * `idx_listings_live_property` (migration 054) serves the sibling probe.
 */

/** Statuses of a record that is on the market. Migration 054 repeats this list in its index. */
export const LIVE_STATUSES = ['Active', 'Coming Soon', 'Pending'] as const;

const LIVE_STATUS_SQL = `(${LIVE_STATUSES.map((status) => `'${status}'`).join(', ')})`;

/**
 * Run in every transaction that reads `collapseCondition`. The planner prices the sibling
 * probes high, so it compiles the query with JIT. The compile takes longer than the query: a
 * state-wide count took 700 ms with JIT and 260 ms without (#716).
 */
export const DISABLE_JIT_SQL = 'SET LOCAL jit = off';

/** The columns of the record that the collapse judges. */
export interface SubjectColumns {
  readonly id: string;
  readonly propertyId: string;
  readonly unitId: string;
  readonly listingType: string;
  readonly officeName: string;
  readonly beds: string;
  readonly baths: string;
  readonly sqft: string;
  readonly price: string;
  readonly status: string;
  readonly listedAt: string;
  readonly propertyType: string;
  /** Null when the seller withheld the address. */
  readonly address: string;
}

/** The subject is a row of `listing_search_v`, which masks `price` the same way for every reader. */
export const VIEW_SUBJECT: SubjectColumns = {
  id: 'v.id',
  propertyId: 'v.property_id',
  unitId: 'v.unit_id',
  listingType: 'v.listing_type',
  officeName: 'v.office_name',
  beds: 'v.beds',
  baths: 'v.baths',
  sqft: 'v.sqft',
  price: 'v.price',
  status: 'v.status',
  listedAt: 'v.listed_at',
  propertyType: 'v.property_type',
  address: 'v.address',
};

/** Rank of a status: a higher rank wins. Pending ranks lowest. */
function statusRank(column: string): string {
  return `CASE ${column} WHEN 'Active' THEN 3 WHEN 'Coming Soon' THEN 2 ELSE 1 END`;
}

/** `o` is a `listings` row. The caller names it in its own `FROM`. */
function mergeableConditions(subject: SubjectColumns): string[] {
  return [
    `o.property_id = ${subject.propertyId}`,
    `o.unit_id IS NOT DISTINCT FROM ${subject.unitId}`,
    `o.id <> ${subject.id}`,
    'o.deleted_at IS NULL AND o.internet_display_allowed',
    `o.consumer_status IN ${LIVE_STATUS_SQL}`,
    `${subject.status} IN ${LIVE_STATUS_SQL}`,
    `o.listing_type = ${subject.listingType}`,
    `o.office_name IS NOT NULL AND o.office_name = ${subject.officeName}`,
    `(o.beds IS NULL OR ${subject.beds} IS NULL OR o.beds = ${subject.beds})`,
    `(o.baths_display IS NULL OR ${subject.baths} IS NULL OR o.baths_display = ${subject.baths})`,
    `(o.living_sqft IS NULL OR ${subject.sqft} IS NULL
      OR abs(o.living_sqft - ${subject.sqft}) <= 0.1 * greatest(o.living_sqft, ${subject.sqft}))`,
    // A hidden price cannot prove the two records agree, so the records stay apart.
    `${subject.price} > 0 AND o.price_display_allowed AND o.list_price > 0`,
    `o.list_price <= 2 * ${subject.price} AND ${subject.price} <= 2 * o.list_price`,
    // Lots and land: `property_is_parcel` (migration 054) holds the street-line test.
    'NOT COALESCE(property_is_parcel(o.property_id), true)',
    `(${subject.propertyType} NOT IN ('Multi-Family', 'Condo') OR ${subject.unitId} IS NOT NULL)`,
    `NOT EXISTS (
      SELECT 1 FROM listings x
      WHERE x.property_id = ${subject.propertyId}
        AND x.unit_id IS NOT DISTINCT FROM ${subject.unitId}
        AND x.listing_type = ${subject.listingType}
        AND x.deleted_at IS NULL AND x.internet_display_allowed
        AND x.consumer_status IN ${LIVE_STATUS_SQL}
        AND x.office_name IS DISTINCT FROM ${subject.officeName})`,
  ];
}

/** The better-record order, as a row comparison: `o` beats the subject. */
function beatsConditions(subject: SubjectColumns): string {
  return `(COALESCE(o.listed_at, '-infinity'),
      ${statusRank('o.consumer_status')},
      COALESCE(o.source_modification_timestamp, '-infinity'),
      o.id)
    > (COALESCE(${subject.listedAt}, '-infinity'),
      ${statusRank(subject.status)},
      COALESCE((SELECT s.source_modification_timestamp FROM listings s WHERE s.id = ${subject.id}),
        '-infinity'),
      ${subject.id})`;
}

/**
 * A `WHERE` fragment: true when no better record of the same home exists, so the record is its
 * home's card. The cheap probe comes first. The `OR` keeps Postgres on a per-row probe of the index.
 * Without it, the planner turns the heavy test into one anti-join over the whole table.
 */
export function collapseCondition(subject: SubjectColumns = VIEW_SUBJECT): string {
  return `(NOT EXISTS (
      SELECT 1 FROM listings s
      WHERE s.property_id = ${subject.propertyId} AND s.id <> ${subject.id}
        AND s.deleted_at IS NULL AND s.internet_display_allowed
        AND s.consumer_status IN ${LIVE_STATUS_SQL})
    OR NOT EXISTS (
      SELECT 1 FROM listings o
      WHERE ${[...mergeableConditions(subject), beatsConditions(subject)].join('\n        AND ')}))`;
}

/**
 * The other live records of the same home, as a `LATERAL` source. The columns are `also_listed_as`
 * (a JSON array of `{ id, mls_number }`, oldest first) and `listed_since` (the oldest list date of
 * the home). The caller names the alias. A `source_listing_id` equal to the feed key is a record the
 * sync wrote before it stored the MLS number, so it reads as unknown.
 */
export function mergedRecordsLateral(subject: SubjectColumns = VIEW_SUBJECT): string {
  return `(
    SELECT
      COALESCE(json_agg(json_build_object(
        'id', o.id,
        'mls_number', NULLIF(o.source_listing_id, o.source_listing_key))
        ORDER BY o.listed_at NULLS LAST, o.id), '[]'::json) AS also_listed_as,
      LEAST(${subject.listedAt}, min(o.listed_at)) AS listed_since
    FROM listings o
    WHERE ${mergeableConditions(subject).join('\n      AND ')}
      -- A record that withholds its address is never tied to one that shows it (#48).
      AND o.address_display_allowed = (${subject.address} IS NOT NULL)
  )`;
}
