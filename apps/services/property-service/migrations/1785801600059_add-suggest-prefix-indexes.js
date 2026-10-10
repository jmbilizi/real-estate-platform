exports.shorthands = undefined;

/**
 * #781. Prefix indexes for `GET /listings/suggest`. Each is partial on the visibility rule every
 * read uses and carries the output columns, so the query is an index-only scan.
 *
 * `CONCURRENTLY`, one statement per `pgm.sql`, in a non-transactional migration (#755 guard).
 */
const VISIBLE = `deleted_at IS NULL
        AND internet_display_allowed
        AND consumer_status IS NOT NULL
        AND (consumer_status <> 'Sold' OR close_date IS NOT NULL)
        AND city IS NOT NULL AND state IS NOT NULL`;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_suggest_city
      ON listings (lower(city) text_pattern_ops, lower(state))
      INCLUDE (city, state)
      WHERE ${VISIBLE}
  `);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_suggest_zip
      ON listings (zip5 text_pattern_ops)
      INCLUDE (city, state)
      WHERE ${VISIBLE} AND zip5 IS NOT NULL
  `);
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_suggest_neighborhood
      ON listings (lower(neighborhood) text_pattern_ops, lower(city), lower(state))
      INCLUDE (neighborhood, city, state)
      WHERE ${VISIBLE} AND neighborhood IS NOT NULL
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_suggest_city');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_suggest_zip');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_suggest_neighborhood');
};
