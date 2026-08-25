exports.shorthands = undefined;

/**
 * `seed_state` — what the in-cluster seeder has already applied (#111).
 *
 * The seeder needs a durable answer to "is the sample data in this database the sample data this
 * image ships?", because an empty `listings` table only identifies the very first run. Without it,
 * an edit to `src/seed/mock-listings.ts` would never reach an already-seeded database, and the
 * alternative trigger — re-seed on every boot — would either duplicate every listing (the seed mints
 * a fresh uuid per row and `listings` has no ON CONFLICT target) or churn the database on every
 * redeploy.
 *
 * Keyed rather than single-row: the seed dataset is the only entry today, but a future ingest
 * checkpoint belongs here rather than in a second table. `applied_hash` is a hash of the dataset
 * CONTENT, never the image tag — a rebuild that did not change the data must not look like a change.
 *
 * This table is deliberately NOT `is_sample`-labelled: it is bookkeeping about sample data, not
 * sample data, and it must survive the `DELETE ... WHERE is_sample` sweep that a re-seed performs.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('seed_state', {
    key: { type: 'text', primaryKey: true },
    applied_hash: { type: 'text', notNull: true },
    applied_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Defined once in migration 000 and referenced by body-less trigger definitions everywhere else.
  pgm.createTrigger('seed_state', 'seed_state_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('seed_state');
};
