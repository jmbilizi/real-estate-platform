exports.shorthands = undefined;

/**
 * #828. Reach aggregate, funnel view and retention view on top of the #824 tables.
 *
 * `analytics_daily` counts events. It cannot count distinct sessions or visitors, so a funnel built
 * on it overcounts. `analytics_daily_reach` holds distinct sessions and visitors per day and event.
 * `refresh_analytics_daily_reach(from_day)` recounts the days from `from_day` out of the raw rows.
 * The route timer calls it hourly for the last 3 days. A day older than the raw retention keeps its
 * row. The function takes a transaction lock and returns false when another pod holds it.
 *
 * `analytics_funnel_sessions_daily_v` returns distinct sessions per funnel step and the step rates.
 *
 * `analytics_retention_weekly_v` groups visitors (`anon_id`) by the week of their first event
 * (UTC, Monday start). A visitor is retained at day N when the visitor has an event exactly N days
 * after the first-seen day. A rate is NULL until the whole cohort week is N days old. First-seen is
 * computed from the raw rows of the last 13 months (the raw retention), so the scan has a time bound and first-seen moves forward as old rows leave the window.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex('analytics_events', ['anon_id', 'occurred_at'], {
    name: 'idx_analytics_events_anon_occurred_at',
    where: 'anon_id IS NOT NULL',
  });

  pgm.createTable('analytics_daily_reach', {
    day: { type: 'date', notNull: true },
    event: { type: 'text', notNull: true },
    sessions: { type: 'bigint', notNull: true, default: 0 },
    visitors: { type: 'bigint', notNull: true, default: 0 },
  });
  pgm.addConstraint('analytics_daily_reach', 'analytics_daily_reach_pk', {
    primaryKey: ['day', 'event'],
  });

  pgm.sql(`
    CREATE FUNCTION refresh_analytics_daily_reach(from_day date) RETURNS boolean
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT pg_try_advisory_xact_lock(828, 1) THEN
        RETURN false;
      END IF;
      DELETE FROM analytics_daily_reach WHERE day >= from_day;
      INSERT INTO analytics_daily_reach (day, event, sessions, visitors)
      SELECT (occurred_at AT TIME ZONE 'UTC')::date, event,
             count(DISTINCT session_id), count(DISTINCT anon_id)
      FROM analytics_events
      WHERE occurred_at >= from_day::timestamp AT TIME ZONE 'UTC'
      GROUP BY 1, 2;
      RETURN true;
    END
    $$
  `);

  pgm.sql(`
    CREATE VIEW analytics_funnel_sessions_daily_v AS
    SELECT day,
           search_sessions,
           impression_sessions,
           click_sessions,
           view_sessions,
           save_sessions,
           lead_start_sessions,
           lead_submit_sessions,
           round(click_sessions::numeric / NULLIF(impression_sessions, 0), 4) AS impression_to_click_rate,
           round(save_sessions::numeric / NULLIF(view_sessions, 0), 4) AS view_to_save_rate,
           round(lead_start_sessions::numeric / NULLIF(view_sessions, 0), 4) AS view_to_lead_start_rate,
           round(lead_submit_sessions::numeric / NULLIF(lead_start_sessions, 0), 4) AS lead_start_to_submit_rate
    FROM (
      SELECT day,
             COALESCE(sum(sessions) FILTER (WHERE event = 'search'), 0) AS search_sessions,
             COALESCE(sum(sessions) FILTER (WHERE event = 'listing_impression'), 0) AS impression_sessions,
             COALESCE(sum(sessions) FILTER (WHERE event = 'listing_click'), 0) AS click_sessions,
             COALESCE(sum(sessions) FILTER (WHERE event = 'listing_view'), 0) AS view_sessions,
             COALESCE(sum(sessions) FILTER (WHERE event = 'listing_save'), 0) AS save_sessions,
             COALESCE(sum(sessions) FILTER (WHERE event = 'lead_start'), 0) AS lead_start_sessions,
             COALESCE(sum(sessions) FILTER (WHERE event = 'lead_submit'), 0) AS lead_submit_sessions
      FROM analytics_daily_reach
      GROUP BY day
    ) d
  `);

  pgm.sql(`
    CREATE VIEW analytics_retention_weekly_v AS
    WITH activity AS (
      SELECT DISTINCT anon_id, (occurred_at AT TIME ZONE 'UTC')::date AS day
      FROM analytics_events
      WHERE anon_id IS NOT NULL
        AND occurred_at >= date_trunc('week', now() - interval '13 months')
    ),
    first_seen AS (
      SELECT anon_id, min(day) AS first_day FROM activity GROUP BY anon_id
    ),
    per_visitor AS (
      SELECT f.anon_id,
             f.first_day,
             COALESCE(bool_or(a.day = f.first_day + 1), false) AS d1,
             COALESCE(bool_or(a.day = f.first_day + 7), false) AS d7,
             COALESCE(bool_or(a.day = f.first_day + 30), false) AS d30
      FROM first_seen f
      JOIN activity a ON a.anon_id = f.anon_id
      GROUP BY f.anon_id, f.first_day
    ),
    weeks AS (
      SELECT date_trunc('week', first_day)::date AS first_seen_week,
             count(*) AS cohort_size,
             count(*) FILTER (WHERE d1) AS d1_retained,
             count(*) FILTER (WHERE d7) AS d7_retained,
             count(*) FILTER (WHERE d30) AS d30_retained
      FROM per_visitor
      GROUP BY 1
    )
    SELECT first_seen_week,
           cohort_size,
           d1_retained,
           d7_retained,
           d30_retained,
           CASE WHEN first_seen_week + 7 <= today
                THEN round(d1_retained::numeric / cohort_size, 4) END AS d1_rate,
           CASE WHEN first_seen_week + 13 <= today
                THEN round(d7_retained::numeric / cohort_size, 4) END AS d7_rate,
           CASE WHEN first_seen_week + 36 <= today
                THEN round(d30_retained::numeric / cohort_size, 4) END AS d30_rate
    FROM weeks, (SELECT (now() AT TIME ZONE 'UTC')::date AS today) t
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS analytics_retention_weekly_v');
  pgm.sql('DROP VIEW IF EXISTS analytics_funnel_sessions_daily_v');
  pgm.sql('DROP FUNCTION IF EXISTS refresh_analytics_daily_reach(date)');
  pgm.dropTable('analytics_daily_reach');
  pgm.dropIndex('analytics_events', ['anon_id', 'occurred_at'], {
    name: 'idx_analytics_events_anon_occurred_at',
  });
};
