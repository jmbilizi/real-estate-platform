exports.shorthands = undefined;

/**
 * #548. Expression statistics for the map viewport predicate.
 *
 * `idx_listings_map_coords` (migration 036) is a partial index. Postgres reads statistics for an
 * index expression only when the query implies the index predicate. The map query does not, so the
 * planner used the default range selectivity (0.5% per bound) and expected 2 rows for a viewport
 * holding 100,000 homes. It then drove the join from the coordinate index and sorted every row.
 *
 * Statistics on the table expressions give the planner the real selectivity. A wide viewport then
 * reads `idx_listings_newest` in order and stops at the pin cap. A neighborhood viewport still uses
 * the coordinate index. No planner setting and no new index is involved.
 *
 * The expressions repeat the view's masked `latitude` and `longitude` verbatim, so Postgres matches
 * them. `CREATE STATISTICS` takes a short lock. `ANALYZE` blocks no writes.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE STATISTICS IF NOT EXISTS stx_listings_map_coords
      ON (CASE WHEN address_display_allowed THEN latitude END),
         (CASE WHEN address_display_allowed THEN longitude END)
      FROM listings
  `);
  pgm.sql('ANALYZE listings');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP STATISTICS IF EXISTS stx_listings_map_coords');
};
