import {
  type ListingDetail,
  type ListingsEnvelope,
  type ListingsMeta,
  NEIGHBORHOOD_PREVIEW_PHOTOS_MAX,
  neighborhoodKey,
  type NeighborhoodsRequest,
  type NeighborhoodsResponse,
  neighborhoodsResponseSchema,
  NOT_FOUND_BODY,
  PAGE_SIZE_DEFAULT,
  resultOffsetFor,
  type SearchRequest,
  slugify,
} from '@cribstop/property-contracts';
import { titleCase } from '../jobs/bright-map/address-format';
import type { AddressClassification } from '../db/mls-attributes';
import { neighborhoodNotNoiseSql, neighborhoodSlugSql } from '../db/neighborhood-normalize';
import {
  ATTRIBUTE_SELECT,
  LISTING_CARD_SELECT,
  LISTING_DETAIL_SELECT,
  LISTING_VISIBILITY_SQL,
  PROPERTY_RECORD_SELECT,
} from './columns';
import { resolvedSearchRequest } from './on-demand';
import { buildSearchQuery, isScopeOnlyRequest, scopeConditions } from './search-query';
import { visibleListingTypesFor } from './sold-gate';
import {
  type ListingCardDbRow,
  type ListingsMetaDbRow,
  toListingCardRow,
  toListingDetail,
  toListingsMeta,
} from './map-row';
import { applyAddressSuppression, applyCardAddressSuppression } from './suppression';

/**
 * The only module in this service that executes read SQL.
 *
 * Every statement here reads `listing_search_v`, and it is still the sole source of LISTING
 * visibility and display masking — address and coordinates masked together on seller opt-out, whole
 * listing excluded when `internet_display_allowed` is false, unapproved descriptions withheld,
 * statuses with no `consumer_status` excluded, solds gated on `close_date`, `is_sample`
 * OR-propagated. None of those predicates is restated in a WHERE clause here: a second copy of a
 * compliance rule is a second place for it to drift.
 *
 * `getListingAttributes()`/`getPropertyAttributes()` (#128) add a SECOND governance table to that
 * picture: they join or reference `listing_search_v` for the listing-visibility rule above, AND gate
 * on `mls_fields.is_address_bearing`, the field-level closed-vocabulary rule #127/#128 enforce on a
 * table the view does not project. That is a field's own governance, not a restatement of the
 * view's — read their doc comments before treating "no WHERE clause restates the view" as covering
 * them too.
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
 * #53. THE media-suppression predicate, defined once so search and detail cannot disagree about
 * which photos a suppressed listing shows. When `media_display_allowed` is false, only the row
 * `retained_when_suppressed` marks can match at all — never falling back to `sort_order`/
 * `is_primary` — and none at all when no row is marked. That "none at all" is the fail-closed case
 * a media pass that has not run yet must land in, never an arbitrary photo.
 */
const mediaVisibleSql = (listingAlias: string): string =>
  `(${listingAlias}.media_display_allowed OR m.retained_when_suppressed)`;
const MEDIA_VISIBLE = mediaVisibleSql('v');

/**
 * The soonest-first primary image when media is not suppressed: `is_primary` wins; failing that
 * the lowest `sort_order`, with `id` as a final tiebreaker so the chosen image is stable across
 * requests rather than plan-dependent. `MEDIA_VISIBLE` gates the WHERE clause, not this ORDER BY:
 * when media is suppressed there is at most one candidate row (enforced by
 * `idx_listing_media_one_retained`), so `is_primary`/`sort_order` are never consulted to choose
 * among candidates in that case.
 */
const PRIMARY_MEDIA_ORDER = 'm.is_primary DESC, m.sort_order, m.id';

const PRIMARY_MEDIA_JOIN = `
    LEFT JOIN LATERAL (
      SELECT m.source_url AS primary_media_url, m.alt_text AS primary_media_alt_text
      FROM listing_media m
      WHERE m.listing_id = v.id AND m.source_url IS NOT NULL AND ${MEDIA_VISIBLE}
      ORDER BY ${PRIMARY_MEDIA_ORDER}
      LIMIT 1
    ) pm ON true`;

/** #382. The unit number that `propertyPath` needs, read only when the view shows the address. */
const CARD_UNIT_NUMBER = `CASE WHEN v.address IS NULL THEN NULL
         ELSE (SELECT u.unit_number FROM units u WHERE u.id = v.unit_id) END AS unit_number`;

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
    // The same function the route's window check bounds (#65), so the offset enforced and the
    // offset issued are one definition rather than two copies of the same arithmetic.
    const offset = resultOffsetFor(request.page, request.pageSize);

    const pageResult = await client.query<ListingCardDbRow>(
      `SELECT ${LISTING_CARD_SELECT}, pm.primary_media_url, pm.primary_media_alt_text,
              ${CARD_UNIT_NUMBER}
       FROM listing_search_v v${PRIMARY_MEDIA_JOIN}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      [...params, request.pageSize, offset],
    );

    await client.query('COMMIT');

    return {
      // The card's named suppression boundary, applied at the same edge and in the same shape as the
      // detail path's below. `primaryMedia` is joined in from `listing_media` ALONGSIDE the view
      // rather than through it, so the view cannot reach its alt text (#105) — and nothing else on
      // the card escapes the view, which is why this path had no boundary before.
      results: pageResult.rows.map((row) => applyCardAddressSuppression(toListingCardRow(row))),
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
       -- #53. Same MEDIA_VISIBLE rule as PRIMARY_MEDIA_JOIN, applied to the full gallery: when
       -- media is suppressed only the marked row can match, so the detail response degrades to at
       -- most one photo (or none) exactly like the card's primaryMedia, rather than two different
       -- answers for the same listing.
       SELECT json_agg(
                json_build_object('url', m.source_url, 'alt_text', m.alt_text)
                ORDER BY m.is_primary DESC, m.sort_order, m.id
              ) AS media
       FROM listing_media m
       WHERE m.listing_id = v.id AND m.source_url IS NOT NULL AND ${MEDIA_VISIBLE}
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
            count(*)::int                              AS listing_count,
            (
              -- #438. The sync worker's own record of the last run it completed, not a listing
              -- field: a listing's own \`last_updated\` can be older than the run that fetched it,
              -- so "Updated X ago" must read this, never \`max(v.last_updated)\`.
              SELECT r.finished_at
              FROM bright_sync_runs r
              WHERE r.status = 'succeeded'
              ORDER BY r.finished_at DESC NULLS LAST
              LIMIT 1
            )                                          AS last_synced_at
     FROM listing_search_v v`,
  );
  // An aggregate-only SELECT always returns exactly one row, even over zero input rows.
  const row = result.rows[0];
  if (!row) {
    throw new Error('Aggregate query over listing_search_v returned no row.');
  }
  return toListingsMeta(row);
}

/** One group row from the neighborhoods aggregate, before the app-code display transform below. */
interface NeighborhoodDbRow {
  group_total: number;
  /** All columns below are null on the one row returned for an empty page. */
  name: string | null;
  city: string;
  state: string;
  k_name: string;
  k_city: string;
  k_state: string;
  total: number;
  sale: number;
  rent: number;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_south: number | null;
  geo_west: number | null;
  geo_north: number | null;
  geo_east: number | null;
  preview_photos: { url: string; listingId: string }[];
}

const NEIGHBORHOOD_ORDER_SQL: Record<NeighborhoodsRequest['order'], string> = {
  count: 'total DESC, k_name ASC, k_state ASC, k_city ASC',
  name: 'k_name ASC, k_state ASC, k_city ASC',
};

/**
 * `GET /listings/neighborhoods` (#390, #501): the neighborhoods of the listings that
 * `GET /listings` returns for the same filters, grouped by `(lower(state), lower(neighborhood),
 * lower(city))`.
 *
 * Two sources, one result. A request with no filter beyond listing type, status, city, state and
 * `place` reads `listings` directly with `LISTING_VISIBILITY_SQL` (`columns.ts`): the view's
 * joins measured 1-3 seconds for a populous state. Any other filter reads `listing_search_v`
 * through `buildSearchQuery`, the one filter builder. Both use the scope conditions of
 * `search-query.ts`, so the group set is the search's group set on either path.
 *
 * `listingType` `sale` or `rent` filters `total` only. The WHERE keeps both types so `sale` and
 * `rent` stay reported. `minCount` applies to `total`.
 *
 * `mode() WITHIN GROUP` picks the group's most frequent RAW variant for `name`, `city` and `state`.
 * `name` is title-cased and `slug` is derived in the app code below. `key` comes from the lower
 * case group columns, never from the display variant.
 *
 * The centroid and bounds come from a per-row lateral over the page's groups only, so the count
 * aggregate stays an index-only scan. They read only coordinates with address display allowed:
 * `listing_search_v` masks `latitude` and `longitude` on that flag, and the direct path tests the
 * flag itself. A masked row is in no centroid and no bounds.
 */
export async function getNeighborhoods(
  pool: ReadClient,
  request: NeighborhoodsRequest,
): Promise<NeighborhoodsResponse> {
  const { place, minCount, limit, offset, order, slug, ...filters } = request;
  const search = resolvedSearchRequest({
    ...filters,
    sort: 'recommended',
    page: 1,
    pageSize: PAGE_SIZE_DEFAULT,
  });
  const requestedTypes = [...visibleListingTypesFor(search.listingType)];
  const matched: SearchRequest =
    search.listingType === 'sale' || search.listingType === 'rent'
      ? { ...search, listingType: 'all' }
      : search;

  // The view path takes its params from the shared builder. The direct path starts empty.
  const direct = isScopeOnlyRequest(matched);
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  let sourceSql: string;
  let filterSql: string;
  let geoSql: string;
  if (direct) {
    const columns = {
      listingType: 'v.listing_type',
      status: 'v.consumer_status',
      city: 'v.city',
      state: 'v.state',
    };
    sourceSql = 'listings v';
    filterSql = [
      LISTING_VISIBILITY_SQL.replace(/\bl\./g, 'v.'),
      ...scopeConditions(matched, bind, columns),
    ].join('\n         AND ');
    geoSql = 'v.address_display_allowed AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL';
  } else {
    const built = buildSearchQuery(matched);
    params.push(...built.params);
    sourceSql = 'listing_search_v v';
    filterSql = built.where;
    geoSql = 'v.latitude IS NOT NULL AND v.longitude IS NOT NULL';
  }

  // #488. The pairs arrive as two bound arrays and join through unnest.
  const places = place ?? [];
  const placeFilterSql =
    places.length > 0
      ? `AND (lower(v.state), lower(v.city)) IN (
           SELECT lower(p.state), lower(p.city)
             FROM unnest(${bind(places.map((p) => p.state))}::text[],
                         ${bind(places.map((p) => p.city))}::text[]) AS p(state, city))`
      : '';
  const typeFilter = `v.listing_type = ANY(${bind(requestedTypes)})`;
  const minCountParam = bind(minCount);
  const slugParam = bind(slug ?? null);
  const limitParam = bind(limit);
  const offsetParam = bind(offset);
  const inGroup = `lower(v.state) = page.k_state
                AND lower(v.neighborhood) = page.k_name
                AND lower(v.city) = page.k_city`;
  const groupFilter = `${filterSql}
         AND ${neighborhoodNotNoiseSql('v.neighborhood')}
         AND lower(v.neighborhood) <> lower(v.city)
         ${placeFilterSql}`;

  const result = await pool.query<NeighborhoodDbRow>(
    `WITH grouped AS (
       SELECT
         mode() WITHIN GROUP (ORDER BY v.neighborhood)                        AS name,
         mode() WITHIN GROUP (ORDER BY v.city)                                AS city,
         -- mode(), not a bare v.state: GROUP BY below groups on lower(v.state).
         mode() WITHIN GROUP (ORDER BY v.state)                               AS state,
         lower(v.state)                                                       AS k_state,
         lower(v.city)                                                        AS k_city,
         lower(v.neighborhood)                                                AS k_name,
         count(*) FILTER (WHERE ${typeFilter})::int                           AS total,
         count(*) FILTER (WHERE v.listing_type = 'sale')::int                 AS sale,
         count(*) FILTER (WHERE v.listing_type = 'rent')::int                 AS rent
       FROM ${sourceSql}
       WHERE ${groupFilter}
       -- Ordered lower(state) first to match idx_listings_neighborhood_group_status's key order.
       GROUP BY lower(v.state), lower(v.neighborhood), lower(v.city)
     ),
     matching AS (
       SELECT * FROM grouped
        WHERE total >= ${minCountParam}
          AND (${slugParam}::text IS NULL OR ${neighborhoodSlugSql('name')} = ${slugParam})
     ),
     totals AS (SELECT count(*)::int AS group_total FROM matching),
     page AS (
       SELECT *, row_number() OVER (ORDER BY ${NEIGHBORHOOD_ORDER_SQL[order]}) AS rn
         FROM matching
        ORDER BY rn
        LIMIT ${limitParam} OFFSET ${offsetParam}
     )
     -- #486, #501. Centroid, bounds and photos join AFTER the page LIMIT: each lookup runs once per
     -- returned group, and the aggregate above keeps its index-only scan. Both read the matching
     -- listings of the requested type only. An empty page still returns one row, which carries
     -- group_total (an offset past the end keeps the exact total).
     SELECT totals.group_total, page.name, page.city, page.state,
            page.k_name, page.k_city, page.k_state, page.total, page.sale, page.rent,
            geo.lat AS geo_lat, geo.lng AS geo_lng, geo.south AS geo_south, geo.west AS geo_west,
            geo.north AS geo_north, geo.east AS geo_east,
            coalesce(pp.preview_photos, '[]'::jsonb) AS preview_photos
       FROM totals
       LEFT JOIN page ON true
       LEFT JOIN LATERAL (
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v.latitude)::float8  AS lat,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY v.longitude)::float8 AS lng,
                min(v.latitude)::float8 AS south, min(v.longitude)::float8 AS west,
                max(v.latitude)::float8 AS north, max(v.longitude)::float8 AS east
           FROM ${sourceSql}
          WHERE ${filterSql}
            AND ${typeFilter}
            AND ${geoSql}
            AND ${inGroup}
       ) geo ON true
       LEFT JOIN LATERAL (
         SELECT coalesce(
                  jsonb_agg(jsonb_build_object('url', c.url, 'listingId', c.id)
                            ORDER BY c.listed_at DESC NULLS LAST, c.id DESC),
                  '[]'::jsonb) AS preview_photos
           FROM (
             SELECT v.id, v.listed_at, pm.url
               FROM ${sourceSql}
               JOIN LATERAL (
                 SELECT m.source_url AS url
                   FROM listing_media m
                  WHERE m.listing_id = v.id AND m.source_url IS NOT NULL
                    AND ${mediaVisibleSql('v')}
                  ORDER BY ${PRIMARY_MEDIA_ORDER}
                  LIMIT 1
               ) pm ON true
              WHERE ${filterSql}
                AND ${typeFilter}
                AND ${inGroup}
              ORDER BY v.listed_at DESC NULLS LAST, v.id DESC
              LIMIT ${NEIGHBORHOOD_PREVIEW_PHOTOS_MAX}
           ) c
       ) pp ON true
      ORDER BY page.rn`,
    params,
  );

  const rows = result.rows.filter((row) => row.name !== null);
  return neighborhoodsResponseSchema.parse({
    results: rows.map((row) => ({
      key: neighborhoodKey({ state: row.k_state, city: row.k_city, name: row.k_name }),
      name: titleCase(row.name as string),
      city: row.city,
      state: row.state,
      slug: slugify(row.name as string),
      total: row.total,
      sale: row.sale,
      rent: row.rent,
      centroid:
        row.geo_lat === null || row.geo_lng === null
          ? null
          : { lat: row.geo_lat, lng: row.geo_lng },
      bounds:
        row.geo_south === null ||
        row.geo_west === null ||
        row.geo_north === null ||
        row.geo_east === null
          ? null
          : {
              south: row.geo_south,
              west: row.geo_west,
              north: row.geo_north,
              east: row.geo_east,
            },
      ...(row.preview_photos.length > 0 ? { previewPhotos: row.preview_photos } : {}),
    })),
    total: result.rows[0]?.group_total ?? 0,
  });
}

/**
 * Whether a listing exists and is publishable through `listing_search_v` (#131) — the same
 * visibility rule `findListingById` uses, but without the property/unit/media joins a caller that
 * only needs a yes/no answer (the inquiry endpoint's listing-existence gate) does not pay for.
 */
export async function isListingPublishable(pool: ReadClient, id: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM listing_search_v v WHERE v.id = $1) AS exists',
    [id],
  );
  return result.rows[0]?.exists ?? false;
}

/** One `mls_fields`-joined attribute row, as `ATTRIBUTE_SELECT` projects it. */
export interface AttributeDbRow {
  id: string;
  field_id: string;
  value_kind: string;
  value_numeric: string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_timestamp: string | null;
  value_lookup_id: string | null;
  originating_system: string;
  reso_resource: string;
  field_name: string;
  address_classification: AddressClassification | null;
  is_consumer_displayable: boolean;
}

/**
 * Every governed attribute of one listing (#127), address-bearing ones excluded IN SQL when the
 * listing's address is suppressed (#128).
 *
 * The suppression decision belongs to this query, not to the caller: it joins `listing_search_v` on
 * the listing's OWN id and gates `mls_fields.is_address_bearing` in the WHERE clause. That is what
 * makes it structural rather than opt-in — no address-bearing row for a suppressed listing ever
 * leaves Postgres, so there is no "remember to filter" step, no signal to pass wrong, and nothing
 * for a future debug log or early return to leak. A listing absent from the view (excluded,
 * soft-deleted) fails the join and returns nothing, exactly like every other read in this file.
 *
 * `is_address_bearing` is the governance flag itself; `address_classification` (still projected by
 * `ATTRIBUTE_SELECT`) is descriptive context for a caller, never re-derived into a second decision.
 *
 * Ready for #93 to call: nothing in this service exposes an "attributes" field on the wire yet, so
 * nothing calls this function outside its own tests.
 */
export async function getListingAttributes(
  pool: ReadClient,
  listingId: string,
): Promise<AttributeDbRow[]> {
  const result = await pool.query<AttributeDbRow>(
    `SELECT ${ATTRIBUTE_SELECT}
       FROM listing_attributes a
       JOIN mls_fields f ON f.id = a.field_id
       JOIN listing_search_v v ON v.id = a.listing_id
      WHERE a.listing_id = $1
        AND (NOT f.is_address_bearing OR v.address IS NOT NULL)`,
    [listingId],
  );
  return result.rows;
}

/**
 * Every governed attribute of one property (#127), durable across every listing the property has
 * ever carried.
 *
 * DELIBERATE CHOICE: address-bearing attributes are excluded when ANY visible listing on the
 * property has its address suppressed — never keyed on one caller-chosen listing. A durable,
 * offer-independent fact cannot correctly take its visibility from a single offer among possibly
 * several: a property with one suppressed listing and one published listing withholds its
 * address-bearing attributes from BOTH, because publishing them through the published listing would
 * still hand a reader the fact the other listing's seller opted out of. Conservative and
 * fail-closed, matching the default-deny rule the rest of #128 already applies.
 *
 * "Visible" means visible in `listing_search_v` — an excluded or soft-deleted listing contributes
 * no suppression state, matching the view's own row-visibility rule.
 */
export async function getPropertyAttributes(
  pool: ReadClient,
  propertyId: string,
): Promise<AttributeDbRow[]> {
  const result = await pool.query<AttributeDbRow>(
    `SELECT ${ATTRIBUTE_SELECT}
       FROM property_attributes a
       JOIN mls_fields f ON f.id = a.field_id
      WHERE a.property_id = $1
        AND (NOT f.is_address_bearing OR NOT EXISTS (
              SELECT 1 FROM listing_search_v v
               WHERE v.property_id = a.property_id AND v.address IS NULL
            ))`,
    [propertyId],
  );
  return result.rows;
}

/**
 * The Bright keys of one listing, for the per-listing gallery fetch (`on-demand.ts`). `null` for a
 * listing that is not from Bright or is not visible. Visibility goes through `listing_search_v`
 * like every other read, so a withheld listing never triggers a Bright request.
 */
export async function findBrightListingKeys(
  pool: ReadClient,
  id: string,
): Promise<{ listingKey: string; listingId: string | null } | null> {
  const result = await pool.query<{ listing_key: string; listing_id: string | null }>(
    `SELECT l.source_listing_key AS listing_key, s.payload->>'ListingId' AS listing_id
       FROM listing_search_v v
       JOIN listings l ON l.id = v.id
       LEFT JOIN bright_staging_records s
         ON s.resource = 'BrightProperties' AND s.record_key = l.source_listing_key
      WHERE v.id = $1 AND l.source = 'brightMLS' AND l.source_listing_key IS NOT NULL`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : { listingKey: row.listing_key, listingId: row.listing_id };
}

/**
 * Local count for one city and one status code, filtered the same way search is (#328): reads
 * `listing_search_v`, so an excluded or soft-deleted row is never counted. `status` is
 * `source_status` — the raw feed code (`l.status`, matching `listing_statuses.code`) — not the
 * consumer-facing `status` column, because the audit compares this count against one Bright
 * `$count` request per feed status code.
 */
export async function countListingsByCityAndStatus(
  pool: ReadClient,
  params: { readonly city: string; readonly status: string },
): Promise<number> {
  const result = await pool.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM listing_search_v v WHERE v.city = $1 AND v.source_status = $2',
    [params.city, params.status],
  );
  return result.rows[0]?.total ?? 0;
}

/** One local Bright-sourced listing, identified for the daily key reconciliation (#331). */
export interface BrightListingIdentity {
  readonly id: string;
  readonly sourceListingKey: string;
}

/**
 * Local, live (`deleted_at IS NULL`) Bright listings for one area and one set of local status
 * codes, read directly from `listings` rather than `listing_search_v` (#331).
 *
 * Bypasses the view deliberately: reconciliation must find a listing to soft-delete even when it is
 * display-suppressed, address-masked, or otherwise excluded from the view — the view answers "is
 * this shown", not "does Bright still hold this record".
 */
export async function listBrightListingIdentities(
  pool: ReadClient,
  params: {
    readonly city?: string;
    readonly state?: string;
    readonly zip?: string;
    readonly statusCodes: readonly string[];
  },
): Promise<BrightListingIdentity[]> {
  if (params.statusCodes.length === 0) {
    return [];
  }
  const result = await pool.query<{ id: string; source_listing_key: string }>(
    `SELECT id, source_listing_key FROM listings
      WHERE source_system = 'BrightMLS'
        AND source_listing_key IS NOT NULL
        AND deleted_at IS NULL
        AND status = ANY($1::text[])
        AND ($2::text IS NULL OR city = $2)
        AND ($3::text IS NULL OR state = $3)
        AND ($4::text IS NULL OR zip5 = $4)`,
    [params.statusCodes, params.city ?? null, params.state ?? null, params.zip ?? null],
  );
  return result.rows.map((row) => ({ id: row.id, sourceListingKey: row.source_listing_key }));
}

/** One `listing_detail_v` row (#349). The view masks the address and decides displayability. */
export interface PropertyRecordDbRow {
  id: string;
  property_id: string;
  unit_id: string | null;
  listing_data_displayable: boolean;
  market_status: string;
  address_street: string | null;
  unit_number: string | null;
  city: string;
  state: string;
  zip: string;
  property_type: string;
  beds: number | null;
  baths: number | string | null;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  source: string;
  is_sample: boolean;
  last_updated: string | Date;
}

/**
 * One listing in any market status (#349), from `listing_detail_v`. The view already reduces an
 * Off market row to the address and the property record. `null` for an unknown, deleted or
 * internet-suppressed id, so all three share the one 404.
 */
export async function findPropertyRecord(
  pool: ReadClient,
  id: string,
): Promise<PropertyRecordDbRow | null> {
  const result = await pool.query<PropertyRecordDbRow>(
    `SELECT ${PROPERTY_RECORD_SELECT} FROM listing_detail_v d WHERE d.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Every listing of one home (#382), newest first. The home id is a unit id in a subdivided
 * building, else a property id. The view already reduces each Off market row to the record.
 */
export async function findHomeRows(
  pool: ReadClient,
  homeId: string,
): Promise<PropertyRecordDbRow[]> {
  const result = await pool.query<PropertyRecordDbRow>(
    `SELECT ${PROPERTY_RECORD_SELECT}
       FROM listing_detail_v d
      WHERE d.unit_id = $1 OR (d.unit_id IS NULL AND d.property_id = $1)
      ORDER BY d.last_updated DESC, d.id DESC
      LIMIT 100`,
    [homeId],
  );
  return result.rows;
}

/** The history facts of a past listing (#382). Only a row in `listing_search_v` can return. */
export interface HistoryFactsDbRow {
  id: string;
  listing_type: string;
  price: number | null;
  close_price: number | null;
  close_date: string | null;
  last_updated: Date | string;
}

export async function findHistoryFacts(
  pool: ReadClient,
  ids: readonly string[],
): Promise<HistoryFactsDbRow[]> {
  if (ids.length === 0) return [];
  const result = await pool.query<HistoryFactsDbRow>(
    `SELECT v.id, v.listing_type, v.price, v.close_price, v.close_date, v.last_updated
       FROM listing_search_v v
      WHERE v.id = ANY($1::uuid[])`,
    [ids],
  );
  return result.rows;
}

/**
 * Listings at one house number in one city and state (#349), optionally one ZIP. The caller
 * compares the normalized street and unit. A seller-withheld address has a NULL `address_street`,
 * so it never matches: a lookup must not confirm an address the seller withheld.
 */
export async function findAddressCandidates(
  pool: ReadClient,
  params: {
    readonly city: string;
    readonly state: string;
    readonly houseNumber: string;
    readonly zip: string | null;
  },
): Promise<PropertyRecordDbRow[]> {
  const result = await pool.query<PropertyRecordDbRow>(
    `SELECT ${PROPERTY_RECORD_SELECT}
       FROM listing_detail_v d
      WHERE regexp_replace(lower(d.city), '[^a-z0-9]+', ' ', 'g') = $1
        AND d.state = $2
        AND d.address_street ILIKE $3
        AND ($4::text IS NULL OR d.zip = $4)
      LIMIT 500`,
    [
      params.city.toLowerCase(),
      params.state.toUpperCase(),
      // A prefix, not `<n> %`, so `118-120 Main St` is a candidate for `118-120-main-st`.
      `${params.houseNumber.replace(/[%_\\]/g, '')}%`,
      params.zip,
    ],
  );
  return result.rows;
}

export { NOT_FOUND_BODY };
