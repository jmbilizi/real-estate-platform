exports.shorthands = undefined;

/**
 * Area coverage state for the on-demand Bright loader (#329).
 *
 * `routes.ts` used to trigger a load only when `envelope.total === 0`, so a partial holding (a ZIP
 * load staged some `City=Frederick` rows) blocked a full city load forever, and a capped load
 * (`maxRecords` in `on-demand.ts`) was never resumed. The in-memory cooldown was per pod and a
 * failed load consumed it the same as a successful one.
 *
 * One row per `(area_key, feed_tier, source_status)`: coverage is tracked per Bright
 * `StandardStatus` wire value, not once per area. `Closed` (sold) listings run last
 * (`listing_statuses.sort_order`) and can be numerous for a busy city; a shared cap across every
 * status let a large `Closed` backlog starve the statuses that keep a listing on the market, and
 * meant the row could never read `complete`. Splitting the grain lets `on-demand.ts` resume each
 * status independently and give `Closed` its own record cap.
 *
 * `area_key` reuses `on-demand.ts`'s existing `areaKey()` identity (lowercased
 * `city|zip|state`), so a free-text and a structured search for the same place share one row.
 * `resume_key` is the last `ListingKey` fetched in that status's keyset pass — null when the pass
 * has not started or already finished. `attempted_at` is the shared-across-pods, restart-surviving
 * replacement for the old in-memory cooldown map.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
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

  // Defined once in migration 000 and referenced by body-less trigger definitions everywhere else.
  pgm.createTrigger('bright_area_sync', 'bright_area_sync_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    function: 'set_updated_at',
    level: 'ROW',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('bright_area_sync');
};
