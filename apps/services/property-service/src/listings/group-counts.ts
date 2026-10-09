import {
  BROKER_UNLISTED_NAME,
  type BrokersResponse,
  brokersResponseSchema,
  type ListingGroupsRequest,
  OFFICE_KEY_UNLISTED,
  PAGE_SIZE_DEFAULT,
  type SearchRequest,
  type ZipsResponse,
  zipsResponseSchema,
} from '@cribstop/property-contracts';
import { LISTING_VISIBILITY_SQL } from './columns';
import { collapseCondition, DISABLE_JIT_SQL, LISTINGS_SUBJECT } from './collapse';
import { resolvedSearchRequest } from './on-demand';
import type { ReadPool } from './repository';
import {
  buildSearchQuery,
  isScopeOnlyRequest,
  LISTINGS_SCOPE_COLUMNS,
  scopeConditions,
} from './search-query';

/**
 * #722. The group aggregates: the cards of a search, grouped by ZIP code or by listing office.
 *
 * The group counts add up to the search total because both read one filter set and one collapse
 * (#716). Two sources, one result, as in `getNeighborhoods`: a request with no filter beyond the
 * scope reads `listings` directly, any other request reads `listing_search_v` through
 * `buildSearchQuery`.
 *
 * The service never reads brokerage, price or any other field to rank a group. The order is the
 * count or the name, and the key breaks every tie.
 */

/**
 * The SQL that differs between the groupings. The direct source is `listings v`. The view source
 * is `listing_search_v v` joined to `listings l`.
 */
interface GroupSpec {
  readonly directKey: string;
  readonly viewKey: string;
  /** The group name, or `NULL::text` for a grouping whose key is its own name. */
  readonly directName: string;
  readonly viewName: string;
  /** The ORDER BY of the page, over `group_key`, `group_name` and `group_count`. */
  readonly order: Record<ListingGroupsRequest['order'], string>;
}

const ZIP_SPEC: GroupSpec = {
  // Five digits. A feed ZIP+4 must not split one ZIP into several groups.
  directKey: 'left(v.zip5, 5)',
  viewKey: 'left(v.zip, 5)',
  directName: 'NULL::text',
  viewName: 'NULL::text',
  order: { count: 'group_count DESC, group_key ASC', name: 'group_key ASC' },
};

/** #722. The key is the office key, and a listing with no key joins the "unlisted" group. */
const UNLISTED_KEY_SQL = `'${OFFICE_KEY_UNLISTED}'`;
/** The name of the most recently updated listing of the group. `r` is the `listings` row alias. */
const brokerName = (r: string): string =>
  `CASE WHEN bool_and(${r}.office_key IS NULL)
        THEN '${BROKER_UNLISTED_NAME}'
        ELSE (array_agg(${r}.office_name
                        ORDER BY ${r}.source_modification_timestamp DESC NULLS LAST, ${r}.id DESC))[1]
   END`;

const BROKER_SPEC: GroupSpec = {
  directKey: `COALESCE(v.office_key, ${UNLISTED_KEY_SQL})`,
  viewKey: `COALESCE(l.office_key, ${UNLISTED_KEY_SQL})`,
  directName: brokerName('v'),
  viewName: brokerName('l'),
  order: {
    count: 'group_count DESC, group_key ASC',
    name: 'lower(group_name) ASC, group_key ASC',
  },
};

interface GroupDbRow {
  group_total: number;
  listing_total: number;
  /** Null on the one row returned for an empty page. */
  key: string | null;
  name: string | null;
  count: number | null;
}

async function queryGroups(
  pool: ReadPool,
  request: ListingGroupsRequest,
  spec: GroupSpec,
): Promise<GroupDbRow[]> {
  const { minCount, limit, offset, order, ...filters } = request;
  const search: SearchRequest = resolvedSearchRequest({
    ...filters,
    sort: 'recommended',
    page: 1,
    pageSize: PAGE_SIZE_DEFAULT,
  });

  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  let sourceSql: string;
  let filterSql: string;
  let keySql: string;
  let nameSql: string;
  if (isScopeOnlyRequest(search)) {
    sourceSql = 'listings v';
    filterSql = [
      LISTING_VISIBILITY_SQL.replace(/\bl\./g, 'v.'),
      ...scopeConditions(search, bind, LISTINGS_SCOPE_COLUMNS),
      collapseCondition(LISTINGS_SUBJECT),
    ].join('\n         AND ');
    keySql = spec.directKey;
    nameSql = spec.directName;
  } else {
    const built = buildSearchQuery(search);
    params.push(...built.params);
    sourceSql = 'listing_search_v v JOIN listings l ON l.id = v.id';
    filterSql = built.where;
    keySql = spec.viewKey;
    nameSql = spec.viewName;
  }
  const minCountParam = bind(minCount);
  const limitParam = bind(limit);
  const offsetParam = bind(offset);

  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(DISABLE_JIT_SQL);
    const result = await client.query<GroupDbRow>(
      `WITH grouped AS (
         SELECT ${keySql} AS group_key, ${nameSql} AS group_name, count(*)::int AS group_count
           FROM ${sourceSql}
          WHERE ${filterSql}
          GROUP BY ${keySql}
       ),
       matching AS (SELECT * FROM grouped WHERE group_count >= ${minCountParam}),
       totals AS (
         SELECT (SELECT count(*)::int FROM matching) AS group_total,
                (SELECT coalesce(sum(group_count), 0)::int FROM grouped) AS listing_total
       ),
       page AS (
         SELECT *, row_number() OVER (ORDER BY ${spec.order[order]}) AS rn
           FROM matching
          ORDER BY rn
          LIMIT ${limitParam} OFFSET ${offsetParam}
       )
       SELECT totals.group_total, totals.listing_total, page.group_key AS key,
              page.group_name AS name, page.group_count AS count
         FROM totals LEFT JOIN page ON true
        ORDER BY page.rn`,
      params,
    );
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** `GET /listings/brokers`. */
export async function getBrokerGroups(
  pool: ReadPool,
  request: ListingGroupsRequest,
): Promise<BrokersResponse> {
  const rows = await queryGroups(pool, request, BROKER_SPEC);
  return brokersResponseSchema.parse({
    groups: rows
      .filter((row) => row.key !== null)
      .map((row) => ({
        key: row.key as string,
        name: row.name as string,
        count: row.count as number,
      })),
    total: rows[0]?.group_total ?? 0,
    listingTotal: rows[0]?.listing_total ?? 0,
  });
}

/** `GET /listings/zips`. */
export async function getZipGroups(
  pool: ReadPool,
  request: ListingGroupsRequest,
): Promise<ZipsResponse> {
  const rows = await queryGroups(pool, request, ZIP_SPEC);
  return zipsResponseSchema.parse({
    groups: rows
      .filter((row) => row.key !== null)
      .map((row) => ({ key: row.key as string, count: row.count as number })),
    total: rows[0]?.group_total ?? 0,
    listingTotal: rows[0]?.listing_total ?? 0,
  });
}
