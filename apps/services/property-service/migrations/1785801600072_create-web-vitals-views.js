exports.shorthands = undefined;

/**
 * #987. p75 of the `web_vital` event per route template and device class.
 *
 * `analytics_web_vitals_p75_daily_v` gives one row per UTC day, surface, route, device and metric.
 * `analytics_web_vitals_p75_28d_v` gives the same without the day, over the last 28 days. Never
 * average daily p75 values. A p75 over a longer window comes from the raw rows or the 28-day view.
 * `p75` is milliseconds for LCP and INP, and a unitless score for CLS.
 *
 * The partial index keeps the view scans off the other events.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX idx_analytics_events_web_vital_occurred_at
      ON analytics_events (occurred_at) WHERE event = 'web_vital'
  `);

  const select = (daily) => `
    SELECT ${daily ? "(occurred_at AT TIME ZONE 'UTC')::date AS day," : ''}
           surface,
           path_template,
           device,
           props->>'metric' AS metric,
           count(*) AS samples,
           round((percentile_cont(0.75) WITHIN GROUP (ORDER BY (props->>'value')::float8))::numeric, 4) AS p75
    FROM analytics_events
    WHERE event = 'web_vital'
      AND path_template IS NOT NULL
      AND device IS NOT NULL
      ${daily ? '' : "AND occurred_at >= now() - interval '28 days'"}
    GROUP BY ${daily ? '1, 2, 3, 4, 5' : '1, 2, 3, 4'}`;

  pgm.sql(`CREATE VIEW analytics_web_vitals_p75_daily_v AS ${select(true)}`);
  pgm.sql(`CREATE VIEW analytics_web_vitals_p75_28d_v AS ${select(false)}`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS analytics_web_vitals_p75_28d_v');
  pgm.sql('DROP VIEW IF EXISTS analytics_web_vitals_p75_daily_v');
  pgm.sql('DROP INDEX IF EXISTS idx_analytics_events_web_vital_occurred_at');
};
