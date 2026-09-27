exports.shorthands = undefined;

/**
 * #391. Two indexes for the fields migration 038 added.
 *
 * `idx_listings_newly_listed` serves the `newly-listed` sort and the `listedWithinDays` range
 * filter — a leading `listed_at` column serves a range scan the same way `idx_listings_newest`'s
 * `last_updated` does. `idx_listings_price_reduced` serves the `priceReduced` filter: a small
 * partial index, since most rows never carry a price cut.
 *
 * `CONCURRENTLY`, in its own non-transactional migration (AGENTS.md's Bright-sync-starves-Postgres
 * rule, #388): a plain `CREATE INDEX` takes a lock that blocks writes from the live sync worker for
 * as long as the build takes, on a table it writes to continuously. `CREATE INDEX CONCURRENTLY`
 * cannot run inside a transaction block, so it cannot share migration 038's transaction — that
 * migration's `ADD COLUMN`/view work needs one, this one must not have one.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.noTransaction();

  pgm.createIndex(
    'listings',
    [
      { name: 'listed_at', sort: 'DESC NULLS LAST' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_newly_listed',
      concurrently: true,
    },
  );

  pgm.createIndex('listings', ['id'], {
    where: 'deleted_at IS NULL AND internet_display_allowed AND price_reduced',
    name: 'idx_listings_price_reduced',
    concurrently: true,
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.dropIndex('listings', ['id'], {
    name: 'idx_listings_price_reduced',
    concurrently: true,
  });
  pgm.dropIndex('listings', ['listed_at', 'id'], {
    name: 'idx_listings_newly_listed',
    concurrently: true,
  });
};
