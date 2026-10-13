exports.shorthands = undefined;

/**
 * #832. `listing_popularity_14d`: views, saves and leads per listing over the last 14 days.
 *
 * `score` is `ln(1 + views + 3 * saves + 10 * leads)` divided by the highest such value in the
 * same area, so it runs from 0 to 1. The area is `county_fips`. Bright records carry no
 * `county_fips` yet, so the area falls back to state plus the first 3 digits of the ZIP.
 *
 * The view exposes `listing_id` and counts only. No session id, account id or IP reaches it.
 * A listing with no event in the window has no row: readers treat a missing row as score 0.
 * `src/analytics/popularity.ts` refreshes the view every hour. The unique index lets the refresh
 * run CONCURRENTLY, so a read never waits.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE MATERIALIZED VIEW listing_popularity_14d AS
    SELECT listing_id,
           area,
           views,
           saves,
           leads,
           CASE WHEN max(raw) OVER (PARTITION BY area) > 0
                THEN raw / max(raw) OVER (PARTITION BY area)
                ELSE 0 END AS score
    FROM (
      SELECT c.listing_id,
             COALESCE(p.county_fips, p.state || ':' || left(p.zip5, 3)) AS area,
             c.views,
             c.saves,
             c.leads,
             ln(1 + c.views + 3 * c.saves + 10 * c.leads)::double precision AS raw
      FROM (
        SELECT listing_id,
               count(*) FILTER (WHERE event = 'listing_view') AS views,
               count(*) FILTER (WHERE event = 'listing_save') AS saves,
               count(*) FILTER (WHERE event = 'lead_submit') AS leads
        FROM analytics_events
        WHERE listing_id IS NOT NULL
          AND event IN ('listing_view', 'listing_save', 'lead_submit')
          AND occurred_at >= now() - interval '14 days'
        GROUP BY listing_id
      ) c
      JOIN listings l ON l.id = c.listing_id
      JOIN properties p ON p.id = l.property_id
    ) s
  `);
  pgm.sql(
    'CREATE UNIQUE INDEX idx_listing_popularity_14d_listing ON listing_popularity_14d (listing_id)',
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP MATERIALIZED VIEW IF EXISTS listing_popularity_14d');
};
