exports.shorthands = undefined;

/**
 * #824. Analytics contract v2.
 *
 * Event-specific values go in `props` (jsonb), so a new event or property needs no migration. The
 * contract in `@cribstop/property-contracts` is the allow-list. The two CHECK constraints from
 * migration 059 are dropped for that reason: they listed every event and surface in SQL too.
 * Old rows stay valid: every new column is nullable or has a default.
 *
 * `analytics_daily` gains `row_id` (empty when an event has none). That is the only daily
 * dimension besides `day`, `event` and `surface`.
 *
 * `query_text` holds the scrubbed zero-result search text. It is purged after 30 days. Every other
 * raw row is purged after 13 months.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('analytics_events', 'analytics_events_event_check');
  pgm.dropConstraint('analytics_events', 'analytics_events_surface_check');
  pgm.addColumns('analytics_events', {
    schema_version: { type: 'smallint', notNull: true, default: 1 },
    anon_id: { type: 'text' },
    path_template: { type: 'text' },
    device: { type: 'text' },
    utm_source: { type: 'text' },
    utm_medium: { type: 'text' },
    utm_campaign: { type: 'text' },
    referrer_host: { type: 'text' },
    app_version: { type: 'text' },
    row_id: { type: 'text' },
    query_text: { type: 'text' },
    props: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  });
  pgm.createIndex('analytics_events', 'occurred_at', {
    name: 'idx_analytics_events_query_text_occurred_at',
    where: 'query_text IS NOT NULL',
  });

  pgm.addColumn('analytics_daily', { row_id: { type: 'text', notNull: true, default: '' } });
  pgm.dropConstraint('analytics_daily', 'analytics_daily_pk');
  pgm.addConstraint('analytics_daily', 'analytics_daily_pk', {
    primaryKey: ['day', 'event', 'surface', 'row_id'],
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  const oldEvents = "('search', 'listing_view', 'listing_save', 'lead_submit')";
  const oldSurfaces = "('search', 'map', 'detail', 'favorites')";
  pgm.sql(
    `DELETE FROM analytics_events WHERE event NOT IN ${oldEvents} OR surface NOT IN ${oldSurfaces}`,
  );
  pgm.sql(
    `DELETE FROM analytics_daily WHERE event NOT IN ${oldEvents} OR surface NOT IN ${oldSurfaces}`,
  );
  pgm.dropConstraint('analytics_daily', 'analytics_daily_pk');
  pgm.dropColumn('analytics_daily', 'row_id');
  pgm.addConstraint('analytics_daily', 'analytics_daily_pk', {
    primaryKey: ['day', 'event', 'surface'],
  });
  pgm.dropIndex('analytics_events', 'occurred_at', {
    name: 'idx_analytics_events_query_text_occurred_at',
  });
  pgm.dropColumns('analytics_events', [
    'schema_version',
    'anon_id',
    'path_template',
    'device',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'referrer_host',
    'app_version',
    'row_id',
    'query_text',
    'props',
  ]);
  pgm.addConstraint('analytics_events', 'analytics_events_event_check', {
    check: `event IN ${oldEvents}`,
  });
  pgm.addConstraint('analytics_events', 'analytics_events_surface_check', {
    check: `surface IN ${oldSurfaces}`,
  });
};
