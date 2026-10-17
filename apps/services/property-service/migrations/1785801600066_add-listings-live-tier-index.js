exports.shorthands = undefined;

/**
 * #403. `hasLiveListings()` in the Bright sync worker runs
 * `EXISTS (... WHERE source_system = $1 AND deleted_at IS NULL AND is_sample = $2)`.
 * No index covered `is_sample`, so an empty tier forced a scan of every Bright row.
 * This partial index lets the EXISTS stop at the first index entry, or at none.
 *
 * `CONCURRENTLY`, in a non-transactional migration (#755 guard).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_live_tier
      ON listings (source_system, is_sample)
      WHERE deleted_at IS NULL
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_live_tier');
};
