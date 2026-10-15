exports.shorthands = undefined;

/**
 * #725. Cookieless funnel counts.
 *
 * `analytics_events` holds raw rows for 30 days. A row has no IP, user agent, account id, email or
 * free text. `session_id` is a random code from one browser tab. `listing_id` has no foreign key,
 * so a listing delete never blocks an event.
 *
 * `analytics_daily` holds the daily count per event and surface. It keeps no listing or session.
 * It outlives the raw rows.
 *
 * `analytics_funnel_daily_v` returns the daily funnel: the four counts and the two step rates.
 * Run `SELECT * FROM analytics_funnel_daily_v ORDER BY day DESC`. See docs/funnel-analytics.md.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('analytics_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    event: { type: 'text', notNull: true },
    surface: { type: 'text', notNull: true },
    listing_id: { type: 'uuid' },
    session_id: { type: 'text', notNull: true },
  });
  pgm.addConstraint('analytics_events', 'analytics_events_event_check', {
    check: "event IN ('search', 'listing_view', 'listing_save', 'lead_submit')",
  });
  pgm.addConstraint('analytics_events', 'analytics_events_surface_check', {
    check: "surface IN ('search', 'map', 'detail', 'favorites')",
  });
  pgm.createIndex('analytics_events', 'occurred_at', { name: 'idx_analytics_events_occurred_at' });

  pgm.createTable('analytics_daily', {
    day: { type: 'date', notNull: true },
    event: { type: 'text', notNull: true },
    surface: { type: 'text', notNull: true },
    count: { type: 'bigint', notNull: true, default: 0 },
  });
  pgm.addConstraint('analytics_daily', 'analytics_daily_pk', {
    primaryKey: ['day', 'event', 'surface'],
  });

  pgm.sql(`
    CREATE VIEW analytics_funnel_daily_v AS
    SELECT day,
           searches,
           detail_views,
           saves,
           requests,
           round(detail_views::numeric / NULLIF(searches, 0), 4) AS search_to_view_rate,
           round(requests::numeric / NULLIF(detail_views, 0), 4) AS view_to_request_rate
    FROM (
      SELECT day,
             COALESCE(sum(count) FILTER (WHERE event = 'search'), 0) AS searches,
             COALESCE(sum(count) FILTER (WHERE event = 'listing_view'), 0) AS detail_views,
             COALESCE(sum(count) FILTER (WHERE event = 'listing_save'), 0) AS saves,
             COALESCE(sum(count) FILTER (WHERE event = 'lead_submit'), 0) AS requests
      FROM analytics_daily
      GROUP BY day
    ) d
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS analytics_funnel_daily_v');
  pgm.dropTable('analytics_daily');
  pgm.dropTable('analytics_events');
};
