exports.shorthands = undefined;

/**
 * #459. Time on market in minutes and hours for a listing listed today.
 *
 * Stores Bright `StatusChangeTimestamp` raw. Field probe, production feed, 200 newest-modified
 * Active records: `OnMarketTimestamp` 0/200, `StatusChangeTimestamp` 200/200,
 * `MajorChangeTimestamp` 200/200 (changes on any edit, so not a list time). The service derives
 * the precise list instant from this column and `listed_at`.
 *
 * View order repeats migration 041: drop the detail view, drop the search view, recreate search,
 * then detail. `LISTING_DETAIL_V_SQL` is migration 038's definition, unchanged.
 *
 * No backfill: a row fills the next time the sync writes it.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */

const LISTING_DETAIL_V_SQL = `
    CREATE VIEW listing_detail_v AS
    SELECT
      l.id,
      l.property_id,
      l.unit_id,
      (v.id IS NOT NULL)                                    AS listing_data_displayable,
      CASE
        WHEN v.id IS NULL THEN 'Off market'
        WHEN l.status = 'Active Under Contract' THEN 'Under Contract'
        WHEN l.status = 'Closed' THEN 'Sold'
        ELSE l.consumer_status
      END                                                   AS market_status,
      CASE WHEN l.address_display_allowed THEN p.street_line END AS address_street,
      CASE WHEN l.address_display_allowed THEN u.unit_number END AS unit_number,
      l.city,
      l.state,
      l.zip5                                                AS zip,
      p.property_type,
      COALESCE(u.beds, p.beds)                              AS beds,
      COALESCE(u.baths_display, p.baths_display)            AS baths,
      COALESCE(u.living_sqft, p.living_sqft)                AS sqft,
      p.lot_sqft,
      p.year_built,
      l.source,
      (l.is_sample OR p.is_sample OR COALESCE(u.is_sample, false)) AS is_sample,
      l.last_updated
    FROM listings l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN listing_search_v v ON v.id = l.id
    WHERE l.deleted_at IS NULL
      AND l.internet_display_allowed
  `;

exports.up = (pgm) => {
  pgm.addColumn('listings', {
    status_changed_at: { type: 'timestamptz' },
  });

  pgm.sql('DROP VIEW IF EXISTS listing_detail_v');
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
      CASE WHEN l.address_display_allowed THEN p.geog      END AS geog,
      l.address_display_allowed,

      l.city,
      l.state,
      l.zip5                                                AS zip,
      l.neighborhood,
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
      l.listed_at,
      -- #424. Unmasked: the target active date does not re-identify a suppressed address.
      l.coming_soon_date,
      -- #459. Raw Bright StatusChangeTimestamp. The service derives the precise list instant.
      l.status_changed_at,

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
  pgm.sql(LISTING_DETAIL_V_SQL);
};

/**
 * Restores migration 041's views and drops this migration's column.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS listing_detail_v');
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
      CASE WHEN l.address_display_allowed THEN p.geog      END AS geog,
      l.address_display_allowed,

      l.city,
      l.state,
      l.zip5                                                AS zip,
      l.neighborhood,
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
      l.listed_at,
      -- #424. Unmasked: the target active date does not re-identify a suppressed address.
      l.coming_soon_date,

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
  pgm.sql(LISTING_DETAIL_V_SQL);

  pgm.dropColumn('listings', 'status_changed_at');
};
