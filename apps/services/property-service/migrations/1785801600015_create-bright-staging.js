exports.shorthands = undefined;

/**
 * Bright MLS replication staging (#92).
 *
 * These two tables hold the feed as Bright returned it. They are not consumer tables: #93 maps out
 * of them into `properties`/`units`/`listings`. Nothing here is read by the Property API.
 *
 * `bright_staging_records` is one row per Bright record, for every resource. The primary key is
 * `(resource, record_key)`, which is what makes a re-read at a tie boundary idempotent: an
 * incremental pass re-reads every record that shares the watermark instant, and the upsert writes
 * each one over itself instead of duplicating it.
 *
 * `record_key` is text because Bright keys are `Edm.Int64` for media and deletions. Text avoids a
 * precision question this table has no reason to hold.
 *
 * `bright_replication_cursor` is one row per resource. A NULL `cursor_modified_at` means "never
 * replicated", which is the state a full resync restores. `records_staged` is cumulative and feeds
 * the stalled-cursor report.
 *
 * `bright_staging_records` gets no `set_updated_at` trigger. It has no `updated_at` column, and
 * `fetched_at` is written by the upsert itself, because the writer must control it.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('bright_staging_records', {
    resource: { type: 'text', notNull: true },
    record_key: { type: 'text', notNull: true },
    modified_at: { type: 'timestamptz', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    run_id: { type: 'uuid', notNull: true },
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('bright_staging_records', 'bright_staging_records_pkey', {
    primaryKey: ['resource', 'record_key'],
  });

  // #93 reads forward from a watermark, so the cursor field leads the index after the resource.
  pgm.createIndex('bright_staging_records', ['resource', 'modified_at'], {
    name: 'idx_bright_staging_resource_modified',
  });

  pgm.createTable('bright_replication_cursor', {
    resource: { type: 'text', primaryKey: true },
    cursor_modified_at: { type: 'timestamptz' },
    cursor_record_key: { type: 'text' },
    last_run_id: { type: 'uuid' },
    // Defaulted, not literal: the writer omits this column from its INSERT, because a `now()`
    // literal inside a VALUES list consumes no placeholder and shifts every later column off its
    // bound value.
    last_run_at: { type: 'timestamptz', default: pgm.func('now()') },
    records_staged: { type: 'bigint', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Defined once in migration 000 and referenced by body-less trigger definitions everywhere else.
  pgm.createTrigger('bright_replication_cursor', 'bright_replication_cursor_set_updated_at', {
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
  pgm.dropTable('bright_replication_cursor');
  pgm.dropTable('bright_staging_records');
};
