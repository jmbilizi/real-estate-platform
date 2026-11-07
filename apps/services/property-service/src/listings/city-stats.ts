import {
  CITY_STATS_MIN_INPUTS,
  type CityStat,
  type CityStats,
  type CityStatsRequest,
  cityStatsSchema,
} from '@cribstop/property-contracts';
import { collapseCondition, DISABLE_JIT_SQL, LISTINGS_SUBJECT } from './collapse';
import { LISTING_VISIBILITY_SQL } from './columns';
import type { ReadPool } from './repository';

/**
 * #985. City medians over the consumer-visible active listings of one city.
 *
 * Reads `listings` directly, as `getNeighborhoods` does, because the stats need no open house
 * join. The #716 collapse keeps one card per home, so the count equals the search total.
 * The display flags apply here in SQL: a row with the price (or days on market) withheld never
 * enters that median.
 */

interface CityStatsDbRow {
  listing_count: number;
  data_updated_at: Date | string | null;
  price_n: number;
  price_median: string | number | null;
  dom_n: number;
  dom_median: string | number | null;
  ppsf_n: number;
  ppsf_median: string | number | null;
}

function toStat(inputCount: number, median: string | number | null): CityStat {
  const tooFew = inputCount < CITY_STATS_MIN_INPUTS || median === null;
  return { value: tooFew ? null : Math.round(Number(median)), inputCount };
}

export async function getCityStats(pool: ReadPool, request: CityStatsRequest): Promise<CityStats> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(DISABLE_JIT_SQL);
    const result = await client.query<CityStatsDbRow>(
      `WITH base AS (
         SELECT v.last_updated,
                CASE WHEN v.price_display_allowed AND v.list_price > 0 THEN v.list_price END AS price,
                CASE WHEN v.days_on_market_display_allowed AND v.days_on_market >= 0
                     THEN v.days_on_market END AS dom,
                COALESCE(NULLIF(v.living_sqft, 0), NULLIF(u.living_sqft, 0)) AS sqft
           FROM listings v
           JOIN properties p ON p.id = v.property_id
           LEFT JOIN units u ON u.id = v.unit_id
          WHERE ${LISTING_VISIBILITY_SQL.replace(/\bl\./g, 'v.')}
            AND v.consumer_status = 'Active'
            AND v.listing_type = $3
            AND lower(v.city) = lower($1)
            AND lower(v.state) = lower($2)
            AND NOT (v.is_sample OR p.is_sample OR COALESCE(u.is_sample, false))
            AND ${collapseCondition(LISTINGS_SUBJECT)}
       ),
       ppsf AS (
         SELECT price::numeric / sqft AS value FROM base WHERE price IS NOT NULL AND sqft IS NOT NULL
       )
       SELECT (SELECT count(*)::int FROM base) AS listing_count,
              (SELECT max(last_updated) FROM base) AS data_updated_at,
              (SELECT count(price)::int FROM base) AS price_n,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FROM base) AS price_median,
              (SELECT count(dom)::int FROM base) AS dom_n,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dom) FROM base) AS dom_median,
              (SELECT count(*)::int FROM ppsf) AS ppsf_n,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY value) FROM ppsf) AS ppsf_median`,
      [request.city, request.state, request.listingType],
    );
    await client.query('COMMIT');
    const row = result.rows[0];
    if (!row) {
      throw new Error('Aggregate query over listings returned no row.');
    }
    return cityStatsSchema.parse({
      listingCount: row.listing_count,
      medianListPrice: toStat(row.price_n, row.price_median),
      medianDaysOnMarket: toStat(row.dom_n, row.dom_median),
      medianPricePerSqft: toStat(row.ppsf_n, row.ppsf_median),
      dataUpdatedAt:
        row.data_updated_at === null ? null : new Date(row.data_updated_at).toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
