exports.shorthands = undefined;

/**
 * #339. Accurate county and boundary-polygon search need two columns `listing_search_v` never
 * exposed: `properties.county_fips` and `properties.geog`. Both already exist (migration 001) and
 * `geog` is already populated (a generated column from `latitude`/`longitude`), so this is a
 * read-model change only — no ingest change, no backfill.
 *
 * `county_fips` IS NOT YET POPULATED by the Bright mapper (tracked separately, out of scope for
 * this migration). A `county` request parameter therefore returns zero rows today rather than
 * silently running unfiltered, which is the AC's required behaviour either way. The web client
 * never sends this parameter — it resolves a county suggestion to a NAME, and this column is a
 * FIPS CODE, so a name could never self-correct into a match once ingestion starts writing the
 * column. `geog`, below, is the mechanism the web client actually relies on for county accuracy.
 *
 * `geog` IS populated today, so it is what actually makes a county/neighborhood boundary search
 * accurate right now (search-query.ts's `ST_Intersects`). It must be masked on the SAME predicate
 * as `latitude`/`longitude` (migration 011): unmasked, a boundary search's match/no-match outcome
 * for a suppressed-address listing would re-disclose roughly where it is, defeating the opt-out
 * the same way an unmasked coordinate would.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS listing_search_v');
  pgm.sql(`
    CREATE VIEW listing_search_v AS
    SELECT
      l.id,
      l.property_id,
      l.unit_id,
      p.community_id,

      CASE
        WHEN l.address_display_allowed THEN l.title
        ELSE p.property_type || ' in ' || l.city || ', ' || l.state
      END                                                   AS title,

      CASE
        WHEN l.address_display_allowed
        THEN p.street_line || COALESCE(' ' || u.unit_number, '')
      END                                                   AS address,
      CASE WHEN l.address_display_allowed THEN l.latitude  END AS latitude,
      CASE WHEN l.address_display_allowed THEN l.longitude END AS longitude,
      -- #339. Same predicate as latitude/longitude above, same reason: a boundary-polygon search
      -- is a location query, and an unmasked geog would answer it for a suppressed-address listing.
      CASE WHEN l.address_display_allowed THEN p.geog      END AS geog,
      l.address_display_allowed,

      l.city,
      l.state,
      l.zip5                                                AS zip,
      l.neighborhood,
      -- #339. County-level granularity does not re-identify a specific address, so this is
      -- unmasked, matching city/state/zip/neighborhood above rather than address/latitude/longitude.
      p.county_fips                                         AS county_fips,

      l.offer_kind,
      l.listing_type,
      l.consumer_status                                     AS status,
      l.status                                              AS source_status,
      l.source,
      p.property_type,

      CASE WHEN l.price_display_allowed THEN l.list_price END AS price,
      CASE
        WHEN l.price_history_display_allowed THEN l.original_list_price
      END                                                   AS original_list_price,
      l.close_price,
      l.close_date,

      l.beds,
      l.baths_display                                       AS baths,
      l.baths_full,
      l.baths_half,
      l.living_sqft                                         AS sqft,
      l.lot_sqft,
      l.year_built,

      CASE
        WHEN l.address_display_allowed AND l.description_moderation = 'approved'
        THEN l.description
      END                                                   AS description,
      l.amenities,
      l.featured,
      l.featured_reason,
      CASE
        WHEN l.price_history_display_allowed THEN l.price_reduced ELSE false
      END                                                   AS price_reduced,
      l.new_construction,

      CASE
        WHEN l.days_on_market_display_allowed THEN l.days_on_market
      END                                                   AS days_on_market,

      l.media_display_allowed,

      l.broker_name,
      l.broker_phone,
      l.broker_email,
      l.office_name,
      l.office_broker_lead_phone,
      l.office_broker_lead_email,
      l.listing_agent_name,
      COALESCE(l.listing_agent_name, l.broker_name) || ' – ' || l.office_name AS listed_by,

      (l.is_sample OR p.is_sample OR COALESCE(u.is_sample, false)) AS is_sample,

      upcoming_open_house.starts_at                         AS open_house_starts_at,
      upcoming_open_house.ends_at                           AS open_house_ends_at,
      CASE
        WHEN l.address_display_allowed THEN upcoming_open_house.remarks
      END                                                   AS open_house_remarks,

      l.last_updated,
      l.created_at,
      l.updated_at
    FROM listings l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN LATERAL (
      SELECT oh.starts_at, oh.ends_at, oh.remarks
      FROM listing_open_houses oh
      WHERE oh.listing_id = l.id
        AND NOT oh.is_cancelled
        AND oh.ends_at > now()
      ORDER BY oh.starts_at, oh.id
      LIMIT 1
    ) upcoming_open_house ON true
    WHERE l.deleted_at IS NULL
      AND l.internet_display_allowed
      AND l.consumer_status IS NOT NULL
      AND (l.consumer_status <> 'Sold' OR l.close_date IS NOT NULL)
  `);
};

/**
 * Restores migration 020's view verbatim and drops nothing (this migration added no column of its
 * own — `county_fips` and `geog` already existed on `properties`).
 *
 * **RUNNING THIS RE-OPENS THE SAME SELLER PRIVACY LEAK AS EVERY PRIOR VIEW MIGRATION'S `down`.**
 * Never run `migrate-down` past this migration against an environment holding real or fixture
 * suppressed data without re-applying `up` immediately. Prefer dropping and recreating `property_db`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS listing_search_v');
  pgm.sql(`
    CREATE VIEW listing_search_v AS
    SELECT
      l.id,
      l.property_id,
      l.unit_id,
      p.community_id,
      CASE
        WHEN l.address_display_allowed THEN l.title
        ELSE p.property_type || ' in ' || l.city || ', ' || l.state
      END                                                   AS title,
      CASE
        WHEN l.address_display_allowed
        THEN p.street_line || COALESCE(' ' || u.unit_number, '')
      END                                                   AS address,
      CASE WHEN l.address_display_allowed THEN l.latitude  END AS latitude,
      CASE WHEN l.address_display_allowed THEN l.longitude END AS longitude,
      l.address_display_allowed,
      l.city,
      l.state,
      l.zip5                                                AS zip,
      l.neighborhood,
      l.offer_kind,
      l.listing_type,
      l.consumer_status                                     AS status,
      l.status                                              AS source_status,
      l.source,
      p.property_type,
      CASE WHEN l.price_display_allowed THEN l.list_price END AS price,
      CASE
        WHEN l.price_history_display_allowed THEN l.original_list_price
      END                                                   AS original_list_price,
      l.close_price,
      l.close_date,
      l.beds,
      l.baths_display                                       AS baths,
      l.baths_full,
      l.baths_half,
      l.living_sqft                                         AS sqft,
      l.lot_sqft,
      l.year_built,
      CASE
        WHEN l.address_display_allowed AND l.description_moderation = 'approved'
        THEN l.description
      END                                                   AS description,
      l.amenities,
      l.featured,
      l.featured_reason,
      CASE
        WHEN l.price_history_display_allowed THEN l.price_reduced ELSE false
      END                                                   AS price_reduced,
      l.new_construction,
      CASE
        WHEN l.days_on_market_display_allowed THEN l.days_on_market
      END                                                   AS days_on_market,
      l.media_display_allowed,
      l.broker_name,
      l.broker_phone,
      l.broker_email,
      l.office_name,
      l.office_broker_lead_phone,
      l.office_broker_lead_email,
      l.listing_agent_name,
      COALESCE(l.listing_agent_name, l.broker_name) || ' – ' || l.office_name AS listed_by,
      (l.is_sample OR p.is_sample OR COALESCE(u.is_sample, false)) AS is_sample,
      upcoming_open_house.starts_at                         AS open_house_starts_at,
      upcoming_open_house.ends_at                           AS open_house_ends_at,
      CASE
        WHEN l.address_display_allowed THEN upcoming_open_house.remarks
      END                                                   AS open_house_remarks,
      l.last_updated,
      l.created_at,
      l.updated_at
    FROM listings l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN LATERAL (
      SELECT oh.starts_at, oh.ends_at, oh.remarks
      FROM listing_open_houses oh
      WHERE oh.listing_id = l.id
        AND NOT oh.is_cancelled
        AND oh.ends_at > now()
      ORDER BY oh.starts_at, oh.id
      LIMIT 1
    ) upcoming_open_house ON true
    WHERE l.deleted_at IS NULL
      AND l.internet_display_allowed
      AND l.consumer_status IS NOT NULL
      AND (l.consumer_status <> 'Sold' OR l.close_date IS NOT NULL)
  `);
};
