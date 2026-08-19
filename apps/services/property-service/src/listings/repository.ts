import {
  type ListingDetail,
  type ListingsEnvelope,
  type ListingsMeta,
  NOT_FOUND_BODY,
  type SearchRequest,
} from '@cribstop/property-contracts';
import { LISTING_CARD_SELECT, LISTING_DETAIL_SELECT } from './columns';
import { buildSearchQuery } from './search-query';
import {
  type ListingCardDbRow,
  type ListingsMetaDbRow,
  toListingCardRow,
  toListingDetail,
  toListingsMeta,
} from './map-row';
import { applyAddressSuppression } from './suppression';

/**
 * The only module in this service that executes read SQL.
 *
 * Every statement here reads `listing_search_v` and nothing else drives row visibility. The view
 * ENFORCES the display rules — address and coordinates masked together on seller opt-out, whole
 * listing excluded when `internet_display_allowed` is false, unapproved descriptions withheld,
 * statuses with no `consumer_status` excluded, solds gated on `close_date`, `is_sample`
 * OR-propagated — so a query that read the base tables instead would reopen every one of those holes
 * at once, silently. There is deliberately no parameter, header or flag that bypasses it, and none of
 * its predicates is restated in a WHERE clause here: a second copy of a compliance rule is a second
 * place for it to drift.
 *
 * Columns are enumerated from `columns.ts`, never `SELECT *`. The view no longer projects the
 * unmasked `street_line` beside the masked `address` (#48, closed), so this is now defence in depth
 * rather than the sole barrier: `SELECT *` would still pick up the view's compliance predicate
 * inputs, and whatever a future migration adds, without anyone reviewing the change.
 */

/** The narrow seam the repository needs, so tests pass a fake instead of opening a socket. */
export interface QueryResult<T> {
  rows: T[];
}
export interface ReadClient {
  query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}
export interface ReadPool extends ReadClient {
  connect(): Promise<ReadClient & { release: () => void }>;
}

/**
 * The soonest-first primary image. `is_primary` wins; failing that the lowest `sort_order`, with `id`
 * as a final tiebreaker so the chosen image is stable across requests rather than plan-dependent.
 */
const PRIMARY_MEDIA_JOIN = `
    LEFT JOIN LATERAL (
      SELECT m.source_url AS primary_media_url, m.alt_text AS primary_media_alt_text
      FROM listing_media m
      WHERE m.listing_id = v.id AND m.source_url IS NOT NULL
      ORDER BY m.is_primary DESC, m.sort_order, m.id
      LIMIT 1
    ) pm ON true`;

/**
 * Search: an exact `COUNT(*)` and one page, as two statements inside ONE
 * `REPEATABLE READ READ ONLY` transaction.
 *
 * Both properties this buys are load-bearing rather than tidiness:
 *
 *  1. `now()` is TRANSACTION-scoped in Postgres. `listing_search_v` compares `ends_at > now()` to
 *     decide the upcoming open house, so two statements in separate transactions could disagree about
 *     which rows match an `openHouse=true` filter — the count and the page would describe different
 *     result sets, and the client's `pageCount` arithmetic would be built on a number that never
 *     existed.
 *  2. REPEATABLE READ gives both statements one snapshot, so a concurrent ingest cannot land between
 *     them and make `total` disagree with the page for the ordinary reason either.
 *
 * READ ONLY is declared because it is true, and because it lets Postgres reject any accidental write
 * from this path outright rather than trusting that none was written.
 *
 * A page past the end returns an empty `results` with the correct `total` — never a 404. The count is
 * exact and never an estimate: the client renders it as the headline result count and computes
 * `pageCount` from it, so an approximation breaks pagination arithmetic rather than just a label.
 */
export async function searchListings(
  pool: ReadPool,
  request: SearchRequest,
): Promise<ListingsEnvelope> {
  const { where, params, orderBy } = buildSearchQuery(request);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const countResult = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM listing_search_v v WHERE ${where}`,
      params,
    );
    const total = countResult.rows[0]?.total ?? 0;

    // LIMIT/OFFSET are bound, not interpolated — they are caller-influenced values like any other.
    // Their placeholder numbers continue the filter params' sequence, hence the arithmetic.
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;
    const offset = (request.page - 1) * request.pageSize;

    const pageResult = await client.query<ListingCardDbRow>(
      `SELECT ${LISTING_CARD_SELECT}, pm.primary_media_url, pm.primary_media_alt_text
       FROM listing_search_v v${PRIMARY_MEDIA_JOIN}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      [...params, request.pageSize, offset],
    );

    await client.query('COMMIT');

    return {
      results: pageResult.rows.map(toListingCardRow),
      total,
      page: request.page,
      pageSize: request.pageSize,
      pageCount: Math.ceil(total / request.pageSize),
      // The normalised set the server actually applied, echoed so the client can reconcile URL state
      // and explain an empty result. It is the parsed request verbatim — defaults included — because
      // anything else would be a second description of what was applied.
      appliedFilters: { ...request },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Detail: ONE statement whose `FROM` is the view, with `properties`, `units`, media and open houses
 * hanging off it. That ordering is the point — the view is the sole row-visibility gate, so a listing
 * it excludes is never joined to anything and cannot leak a property or unit fact. Reading the base
 * tables first and filtering afterwards would invert that.
 *
 * `null` (not a thrown error) for a missing row, so the route can return the ONE frozen 404 body for
 * an unknown id, a soft-deleted id and a suppressed id alike. Any difference between those three is a
 * confirmation oracle that defeats the seller's opt-out.
 */
export async function findListingById(pool: ReadClient, id: string): Promise<ListingDetail | null> {
  const result = await pool.query<ListingCardDbRow>(
    `SELECT ${LISTING_DETAIL_SELECT},
            p.year_built AS property_year_built,
            p.lot_sqft   AS property_lot_sqft,
            u.unit_number, u.beds AS unit_beds, u.baths_display AS unit_baths,
            u.living_sqft AS unit_sqft,
            media.media,
            open_houses.open_houses
     FROM listing_search_v v
     JOIN properties p ON p.id = v.property_id
     LEFT JOIN units u ON u.id = v.unit_id
     LEFT JOIN LATERAL (
       SELECT json_agg(
                json_build_object('url', m.source_url, 'alt_text', m.alt_text)
                ORDER BY m.is_primary DESC, m.sort_order, m.id
              ) AS media
       FROM listing_media m
       WHERE m.listing_id = v.id AND m.source_url IS NOT NULL
     ) media ON true
     LEFT JOIN LATERAL (
       -- Upcoming occurrences only, on the same \`ends_at > now()\` rule the view applies to the card's
       -- single open house. A showing that has already finished is not actionable, and listing it
       -- would contradict the badge the card renders from the same data.
       SELECT json_agg(
                json_build_object('starts_at', oh.starts_at, 'ends_at', oh.ends_at,
                                  'remarks', oh.remarks)
                ORDER BY oh.starts_at, oh.id
              ) AS open_houses
       FROM listing_open_houses oh
       WHERE oh.listing_id = v.id AND NOT oh.is_cancelled AND oh.ends_at > now()
     ) open_houses ON true
     WHERE v.id = $1`,
    [id],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  // The single named suppression boundary. Applied here, at the edge, so there is exactly one place
  // that decides it and one place to test.
  return applyAddressSuppression(toListingDetail(row));
}

/**
 * Dataset freshness, derived from the SAME view as search so a suppressed or non-consumer-status
 * listing cannot advance the timestamp the footer shows.
 *
 * `MAX(last_updated)` is MLS FEED freshness — never `updated_at`, which a local write moves, and never
 * the time ingestion ran. `last_updated` is deliberately excluded from the `set_updated_at` trigger
 * for exactly this reason, so this value cannot be advanced by anything we do locally and cannot be in
 * the future unless a feed says so.
 */
export async function getListingsMeta(pool: ReadClient): Promise<ListingsMeta> {
  const result = await pool.query<ListingsMetaDbRow>(
    `SELECT max(v.last_updated)                        AS data_updated_at,
            array_agg(DISTINCT v.source ORDER BY v.source) AS sources,
            count(*)::int                              AS listing_count
     FROM listing_search_v v`,
  );
  // An aggregate-only SELECT always returns exactly one row, even over zero input rows.
  const row = result.rows[0];
  if (!row) {
    throw new Error('Aggregate query over listing_search_v returned no row.');
  }
  return toListingsMeta(row);
}

export { NOT_FOUND_BODY };
