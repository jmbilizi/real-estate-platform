import type { SuggestRequest, SuggestResponse } from '@cribstop/property-contracts';
import { SUGGEST_LIMIT_DEFAULT, suggestResponseSchema } from '@cribstop/property-contracts';
import { neighborhoodNotNoiseSql } from '../db/neighborhood-normalize';
import { titleCase } from '../jobs/bright-map/address-format';
import { LISTING_VISIBILITY_SQL } from './columns';
import type { ReadClient } from './repository';

/**
 * `GET /listings/suggest` (#781). Each query is a prefix match on a partial btree index
 * (migration 059) and reads the index only. The index predicate equals `LISTING_VISIBILITY_SQL`,
 * so the planner can use it. `text_pattern_ops` makes `LIKE 'abc%'` use the index in any locale.
 */

interface PlaceRow {
  name: string;
  city: string;
  state: string;
  zip: string | null;
}

/** Escapes `%`, `_` and `\` so a typed character is never a wildcard. */
function likePrefix(q: string): string {
  return `${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
}

const CITY_SQL = `
  SELECT mode() WITHIN GROUP (ORDER BY l.city) AS name,
         mode() WITHIN GROUP (ORDER BY l.city) AS city,
         mode() WITHIN GROUP (ORDER BY l.state) AS state,
         NULL::text AS zip
    FROM listings l
   WHERE ${LISTING_VISIBILITY_SQL}
     AND l.city IS NOT NULL AND l.state IS NOT NULL
     AND lower(l.city) LIKE $1
   GROUP BY lower(l.city), lower(l.state)
   ORDER BY count(*) DESC, lower(l.city)
   LIMIT $2`;

const NEIGHBORHOOD_SQL = `
  SELECT mode() WITHIN GROUP (ORDER BY l.neighborhood) AS name,
         mode() WITHIN GROUP (ORDER BY l.city) AS city,
         mode() WITHIN GROUP (ORDER BY l.state) AS state,
         NULL::text AS zip
    FROM listings l
   WHERE ${LISTING_VISIBILITY_SQL}
     AND l.city IS NOT NULL AND l.state IS NOT NULL
     AND ${neighborhoodNotNoiseSql('l.neighborhood')}
     AND lower(l.neighborhood) LIKE $1
   GROUP BY lower(l.neighborhood), lower(l.city), lower(l.state)
   ORDER BY count(*) DESC, lower(l.neighborhood)
   LIMIT $2`;

const ZIP_SQL = `
  SELECT l.zip5 AS name,
         mode() WITHIN GROUP (ORDER BY l.city) AS city,
         mode() WITHIN GROUP (ORDER BY l.state) AS state,
         l.zip5 AS zip
    FROM listings l
   WHERE ${LISTING_VISIBILITY_SQL}
     AND l.city IS NOT NULL AND l.state IS NOT NULL
     AND l.zip5 LIKE $1
   GROUP BY l.zip5
   ORDER BY l.zip5
   LIMIT $2`;

export async function getSuggestions(
  pool: ReadClient,
  request: SuggestRequest,
): Promise<SuggestResponse> {
  const limit = request.limit ?? SUGGEST_LIMIT_DEFAULT;
  const run = async (sql: string): Promise<PlaceRow[]> =>
    (await pool.query<PlaceRow>(sql, [likePrefix(request.q), limit])).rows;

  // A digit prefix can only be a ZIP: no city is digits, and the noise rule drops digit-only
  // neighborhoods.
  if (/^\d+$/.test(request.q)) {
    const zips = await run(ZIP_SQL);
    return suggestResponseSchema.parse({
      suggestions: zips.map((row) => ({
        kind: 'zip',
        name: row.name,
        city: titleCase(row.city),
        state: row.state.toUpperCase(),
        zip: row.zip,
      })),
    });
  }

  const [cities, neighborhoods] = await Promise.all([run(CITY_SQL), run(NEIGHBORHOOD_SQL)]);
  // Cities lead. Neighborhoods get the remaining slots, and cities keep at least half of them.
  const cityTake = Math.min(
    cities.length,
    Math.max(limit - neighborhoods.length, Math.ceil(limit / 2)),
  );
  return suggestResponseSchema.parse({
    suggestions: [
      ...cities.slice(0, cityTake).map((row) => ({
        kind: 'city',
        name: titleCase(row.name),
        city: titleCase(row.city),
        state: row.state.toUpperCase(),
      })),
      ...neighborhoods.slice(0, limit - cityTake).map((row) => ({
        kind: 'neighborhood',
        name: titleCase(row.name),
        city: titleCase(row.city),
        state: row.state.toUpperCase(),
      })),
    ],
  });
}
