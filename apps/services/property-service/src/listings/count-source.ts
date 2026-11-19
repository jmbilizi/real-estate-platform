import type { SearchRequest } from '@cribstop/property-contracts';
import { LISTING_VISIBILITY_SQL } from './columns';

/**
 * #1050. A light stand-in for `listing_search_v`, used only to COUNT.
 *
 * The view inner-joins `properties`, left-joins `units` and runs a lateral open-house probe for
 * every row. The count needs none of those joins to decide a row, so on the dev dataset
 * (about 815k rows) the exact `total` ran past the statement timeout while the page query
 * (LIMIT 24) did not.
 *
 * Each column has the same name and the same expression as the view column. A column from
 * `properties` or the open-house table is a scalar subselect. Postgres flattens the subquery and
 * drops each subselect that the outer WHERE does not read, so an unused column costs nothing.
 * `listing_search_v` has the same rows: `properties` is joined on a NOT NULL foreign key, `units`
 * and the lateral never drop or repeat a row, and the WHERE is `LISTING_VISIBILITY_SQL`.
 *
 * `listing-search-view.spec.ts` checks every `viewExpression` against the newest view migration.
 */
export interface CountColumn {
  readonly name: string;
  /** SQL over `listings l`. */
  readonly expression: string;
  /** The same value as the newest view migration writes it. Defaults to `expression`. */
  readonly viewExpression?: string;
}

export const COUNT_COLUMNS: readonly CountColumn[] = [
  { name: 'id', expression: 'l.id' },
  { name: 'property_id', expression: 'l.property_id' },
  { name: 'unit_id', expression: 'l.unit_id' },
  { name: 'city', expression: 'l.city' },
  { name: 'state', expression: 'l.state' },
  { name: 'zip', expression: 'l.zip5' },
  { name: 'neighborhood', expression: 'l.neighborhood' },
  { name: 'listing_type', expression: 'l.listing_type' },
  { name: 'status', expression: 'l.consumer_status' },
  { name: 'office_name', expression: 'l.office_name' },
  {
    name: 'latitude',
    expression: 'CASE WHEN l.address_display_allowed THEN l.latitude END',
  },
  {
    name: 'longitude',
    expression: 'CASE WHEN l.address_display_allowed THEN l.longitude END',
  },
  {
    name: 'price',
    expression: 'CASE WHEN l.price_display_allowed THEN l.list_price END',
  },
  {
    name: 'price_reduced',
    expression: 'CASE WHEN l.price_history_display_allowed THEN l.price_reduced ELSE false END',
  },
  { name: 'beds', expression: 'l.beds' },
  { name: 'baths', expression: 'l.baths_display' },
  { name: 'sqft', expression: 'l.living_sqft' },
  { name: 'amenities', expression: 'l.amenities' },
  { name: 'new_construction', expression: 'l.new_construction' },
  { name: 'listed_at', expression: 'l.listed_at' },
  {
    name: 'property_type',
    expression: '(SELECT p.property_type FROM properties p WHERE p.id = l.property_id)',
    viewExpression: 'p.property_type',
  },
  {
    name: 'county_fips',
    expression: '(SELECT p.county_fips FROM properties p WHERE p.id = l.property_id)',
    viewExpression: 'p.county_fips',
  },
  {
    name: 'open_house_starts_at',
    expression: `(SELECT oh.starts_at
      FROM listing_open_houses oh
      WHERE oh.listing_id = l.id
        AND NOT oh.is_cancelled
        AND oh.ends_at > now()
      ORDER BY oh.starts_at, oh.id
      LIMIT 1)`,
    viewExpression: 'upcoming_open_house.starts_at',
  },
];

/** The subquery the count reads, aliased `v` like the view. */
export const COUNT_SOURCE_SQL = `(
  SELECT ${COUNT_COLUMNS.map((c) => `${c.expression} AS ${c.name}`).join(',\n         ')}
  FROM listings l
  WHERE ${LISTING_VISIBILITY_SQL.trim()}
) v`;

/**
 * Filters that read a view column the light source does not carry: masked address, title and
 * the geography. A request with one of them counts through the view, the always correct path.
 */
const VIEW_ONLY_FILTERS = ['query', 'street', 'boundary', 'area'] as const;

export function countSource(request: SearchRequest): string {
  const needsView = VIEW_ONLY_FILTERS.some((key) => {
    const value = (request as Record<string, unknown>)[key];
    return value !== undefined && value !== null && value !== '';
  });
  return needsView ? 'listing_search_v v' : COUNT_SOURCE_SQL;
}
