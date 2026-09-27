exports.shorthands = undefined;

/**
 * The Bright sync worker's run log and checkpoints (#338). Retires `bright_area_sync` (#329): the
 * worker replicates the whole feed, so per-area coverage no longer exists.
 *
 * `bright_sync_runs` holds one row per run. The admin endpoint inserts a `requested` row and the
 * worker claims it. `counts` and `cursor` are progress the worker rewrites as the run advances.
 *
 * `bright_sync_state` holds one checkpoint per `(feed_tier, stream)`. `backfill:<status>` keeps
 * `{ through, complete }`: every record modified at or before `through` is written. `incremental`
 * keeps the `ModificationTimestamp` watermark. A restart resumes from these rows.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('bright_sync_runs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    mode: {
      type: 'text',
      notNull: true,
      check: "mode IN ('incremental', 'backfill', 'reconcile', 'audit')",
    },
    scope: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    status: {
      type: 'text',
      notNull: true,
      check: "status IN ('requested', 'running', 'succeeded', 'failed')",
    },
    feed_tier: { type: 'text' },
    counts: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    cursor: { type: 'jsonb' },
    error: { type: 'text' },
    requested_by: { type: 'text', notNull: true },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('bright_sync_runs', ['status', 'requested_at'], {
    name: 'idx_bright_sync_runs_status_requested',
  });
  pgm.createIndex('bright_sync_runs', [{ name: 'requested_at', sort: 'DESC' }], {
    name: 'idx_bright_sync_runs_requested_desc',
  });
  pgm.createTrigger('bright_sync_runs', 'bright_sync_runs_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at',
    level: 'ROW',
  });

  pgm.createTable('bright_sync_state', {
    feed_tier: { type: 'text', notNull: true },
    stream: { type: 'text', notNull: true },
    state: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('bright_sync_state', 'bright_sync_state_pkey', {
    primaryKey: ['feed_tier', 'stream'],
  });
  pgm.createTrigger('bright_sync_state', 'bright_sync_state_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at',
    level: 'ROW',
  });

  pgm.dropTable('bright_area_sync');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('bright_sync_state');
  pgm.dropTable('bright_sync_runs');
  pgm.createTable('bright_area_sync', {
    area_key: { type: 'text', notNull: true },
    feed_tier: { type: 'text', notNull: true },
    source_status: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, check: "status IN ('complete', 'partial', 'failed')" },
    source_count: { type: 'integer' },
    loaded_count: { type: 'integer', notNull: true, default: 0 },
    resume_key: { type: 'text' },
    synced_at: { type: 'timestamptz' },
    attempted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('bright_area_sync', 'bright_area_sync_pkey', {
    primaryKey: ['area_key', 'feed_tier', 'source_status'],
  });
  pgm.createTrigger('bright_area_sync', 'bright_area_sync_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at',
    level: 'ROW',
  });
};
