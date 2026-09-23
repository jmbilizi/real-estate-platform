exports.shorthands = undefined;

/**
 * Records which Bright feed tier wrote each staging row and cursor (#314).
 *
 * A tier switch (`BRIGHT_MLS_ENV` test to production, or back) must not let the next run treat the
 * other tier's staged rows as its own: test and production `ListingKey` values are plain counters
 * and can collide. `feed_tier` joins the primary key of both tables, so a switch stages under a
 * disjoint key instead of overwriting or colliding with the other tier's row. `run.ts` sweeps the
 * other tier's rows before it replicates (see `bright-map/sweep.ts`).
 *
 * BACKFILL CHOICE: existing rows carry no recorded tier. `BRIGHT_MLS_ENV`, read from the migration
 * process's own environment, names the tier actually running here right now, so existing rows are
 * backfilled to it. When the variable is absent, or is not exactly `test` or `production`, the tier
 * cannot be known and the existing rows are purged instead — a fresh replication pass re-stages them
 * correctly tagged, and a wrongly-tagged row is worse than an empty table.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  const raw = (process.env.BRIGHT_MLS_ENV ?? '').trim().toLowerCase();
  const knownTier = raw === 'test' || raw === 'production' ? raw : null;

  pgm.addColumn('bright_staging_records', { feed_tier: { type: 'text' } });
  pgm.addColumn('bright_replication_cursor', { feed_tier: { type: 'text' } });

  if (knownTier === null) {
    pgm.sql('DELETE FROM bright_staging_records;');
    pgm.sql('DELETE FROM bright_replication_cursor;');
  } else {
    pgm.sql(pgm.format('UPDATE bright_staging_records SET feed_tier = %L;', knownTier));
    pgm.sql(pgm.format('UPDATE bright_replication_cursor SET feed_tier = %L;', knownTier));
  }

  pgm.alterColumn('bright_staging_records', 'feed_tier', { notNull: true });
  pgm.alterColumn('bright_replication_cursor', 'feed_tier', { notNull: true });

  // The tier joins both keys, so a re-ingest under the other tier stages under a disjoint identity
  // instead of colliding with (or overwriting) a leftover row from the tier being swept.
  pgm.dropConstraint('bright_staging_records', 'bright_staging_records_pkey');
  pgm.addConstraint('bright_staging_records', 'bright_staging_records_pkey', {
    primaryKey: ['feed_tier', 'resource', 'record_key'],
  });

  pgm.dropConstraint('bright_replication_cursor', 'bright_replication_cursor_pkey');
  pgm.addConstraint('bright_replication_cursor', 'bright_replication_cursor_pkey', {
    primaryKey: ['feed_tier', 'resource'],
  });

  // #93 reads forward from a watermark scoped to one tier, so the tier leads the index too.
  pgm.dropIndex('bright_staging_records', ['resource', 'modified_at'], {
    name: 'idx_bright_staging_resource_modified',
  });
  pgm.createIndex('bright_staging_records', ['feed_tier', 'resource', 'modified_at'], {
    name: 'idx_bright_staging_resource_modified',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('bright_staging_records', ['feed_tier', 'resource', 'modified_at'], {
    name: 'idx_bright_staging_resource_modified',
  });
  pgm.createIndex('bright_staging_records', ['resource', 'modified_at'], {
    name: 'idx_bright_staging_resource_modified',
  });

  pgm.dropConstraint('bright_replication_cursor', 'bright_replication_cursor_pkey');
  pgm.addConstraint('bright_replication_cursor', 'bright_replication_cursor_pkey', {
    primaryKey: ['resource'],
  });

  pgm.dropConstraint('bright_staging_records', 'bright_staging_records_pkey');
  pgm.addConstraint('bright_staging_records', 'bright_staging_records_pkey', {
    primaryKey: ['resource', 'record_key'],
  });

  pgm.dropColumn('bright_replication_cursor', 'feed_tier');
  pgm.dropColumn('bright_staging_records', 'feed_tier');
};
