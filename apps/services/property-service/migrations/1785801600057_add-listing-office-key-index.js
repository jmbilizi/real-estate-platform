exports.shorthands = undefined;

/**
 * #722. Serves the broker aggregate and the `officeKey` filter. The partial predicate matches the
 * visible rows every search reads, so the index stays small and the planner can use it.
 *
 * `CONCURRENTLY`, in its own non-transactional migration, for the same reason as migration 039: a
 * plain `CREATE INDEX` blocks the sync worker's writes for the whole build.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.noTransaction();
  pgm.createIndex('listings', ['office_key', 'id'], {
    name: 'idx_listings_office_key',
    where: 'deleted_at IS NULL AND internet_display_allowed',
    concurrently: true,
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.dropIndex('listings', ['office_key', 'id'], {
    name: 'idx_listings_office_key',
    concurrently: true,
  });
};
