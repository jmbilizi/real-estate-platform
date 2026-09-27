exports.shorthands = undefined;

/**
 * #391. "Just listed" and "New this week" need a real list date; the feed mapper stored none.
 *
 * `listings.listed_at` is Bright's `MLSListDate`, widened to an instant. `listing_search_v` exposes
 * it unmasked. A list date does not re-identify a suppressed address, unlike `address`/`geog`.
 *
 * `listing_detail_v` (migration 033) is `LEFT JOIN listing_search_v`. This is the first view
 * migration since 033, so the first to hit that dependency: a bare `DROP VIEW listing_search_v`
 * fails with "other objects depend on it" unless the dependent view is dropped first.
 * `LISTING_DETAIL_V_SQL` below is migration 033's definition, unchanged, kept as one constant so
 * `up()` and `down()` recreate the exact same view rather than two hand-copies that can drift.
 * A later view migration must repeat the same drop-detail / drop-search / create-search /
 * create-detail order for as long as `listing_detail_v` exists.
 *
 * The two new indexes (`newly-listed` sort, `listedWithinDays`, `priceReduced`) are a separate
 * migration (`1785801600039`): `CREATE INDEX CONCURRENTLY` cannot run inside this migration's
 * transaction, and this file's `ADD COLUMN`/view work needs one.
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
    listed_at: { type: 'timestamptz' },
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
      -- #391. Unmasked: the list date does not re-identify a suppressed address, unlike
      -- address/latitude/longitude/geog above.
      l.listed_at,

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
 * Restores migration 030's view verbatim and drops this migration's column.
 *
 * **RUNNING THIS RE-OPENS THE SAME SELLER PRIVACY LEAK AS EVERY PRIOR VIEW MIGRATION'S `down`.**
 * Never run `migrate-down` past this migration against an environment holding real or fixture
 * suppressed data without re-applying `up` immediately. Prefer dropping and recreating `property_db`.
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

  pgm.dropColumn('listings', 'listed_at');
};
