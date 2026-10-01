exports.shorthands = undefined;

/**
 * #501. The neighborhoods aggregate now applies the search status filter
 * (`consumer_status = ANY(...)`, default Active and Coming Soon), so its group set equals the
 * search's. Migration 040's index does not carry `consumer_status`, so that filter would force a
 * heap fetch per row. This index adds the column to `INCLUDE`. The aggregate stays an index-only
 * scan. Same key order and same partial predicate as migration 040. The old index is dropped: no
 * query can use it that the new one does not serve.
 *
 * `CONCURRENTLY` plus `pgm.noTransaction()`: `bright-sync-worker` writes `listings` continuously.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.noTransaction();

  // A failed earlier build leaves an INVALID index of this name. IF NOT EXISTS would skip it.
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_neighborhood_group_status');
  pgm.sql(`
    CREATE INDEX CONCURRENTLY idx_listings_neighborhood_group_status
      ON listings (lower(state), lower(neighborhood), lower(city))
      INCLUDE (state, neighborhood, city, listing_type, consumer_status)
      WHERE deleted_at IS NULL
        AND internet_display_allowed
        AND consumer_status IS NOT NULL
        AND (consumer_status <> 'Sold' OR close_date IS NOT NULL)
        AND neighborhood IS NOT NULL
  `);
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_neighborhood_group');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.noTransaction();

  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_neighborhood_group
      ON listings (lower(state), lower(neighborhood), lower(city))
      INCLUDE (state, neighborhood, city, listing_type)
      WHERE deleted_at IS NULL
        AND internet_display_allowed
        AND consumer_status IS NOT NULL
        AND (consumer_status <> 'Sold' OR close_date IS NOT NULL)
        AND neighborhood IS NOT NULL
  `);
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_neighborhood_group_status');
};
