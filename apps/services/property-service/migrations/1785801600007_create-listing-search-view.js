exports.shorthands = undefined;

/**
 * `listing_search_v`: the read model for search and detail.
 *
 * This view ENFORCES the display rules rather than merely carrying the flags, because a flag that
 * every caller must remember to check is a flag that will eventually be forgotten in one query.
 *
 * Dwelling predicates (beds/baths/sqft/price) read the snapshot columns on `listings`, so filtering
 * never spans tables and stays indexable. The join to `properties` is a single primary-key lookup and
 * is unavoidable: the street address is a durable property fact, and #22's `street` and free-text
 * `query` filters need it. `units` is a LEFT JOIN because units are optional.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE VIEW listing_search_v AS
    SELECT
      l.id,
      l.property_id,
      l.unit_id,
      p.community_id,
      l.title,

      -- Seller address suppression (RESO InternetAddressDisplayYN). The coordinates are masked with
      -- the address, not separately: publishing the point re-identifies the address the seller opted
      -- out of, so leaking either defeats the opt-out.
      CASE
        WHEN l.address_display_allowed
        THEN p.street_line || COALESCE(' ' || u.unit_number, '')
      END                                                   AS address,
      CASE WHEN l.address_display_allowed THEN l.latitude  END AS latitude,
      CASE WHEN l.address_display_allowed THEN l.longitude END AS longitude,
      l.address_display_allowed,

      p.street_line,
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

      l.list_price                                          AS price,
      l.original_list_price,
      l.close_price,
      l.close_date,

      l.beds,
      l.baths_display                                       AS baths,
      l.baths_full,
      l.baths_half,
      l.living_sqft                                         AS sqft,
      l.lot_sqft,
      l.year_built,

      -- Suppressed copy must not reach a consumer payload at all.
      CASE WHEN l.description_moderation = 'approved' THEN l.description END AS description,
      l.amenities,
      l.featured,
      l.featured_reason,
      l.price_reduced,
      l.new_construction,

      l.broker_name,
      l.broker_phone,
      l.broker_email,
      l.office_name,
      l.office_broker_lead_phone,
      l.office_broker_lead_email,
      l.listing_agent_name,
      -- The client's required \`listedBy\` (NAR 7.58 "Listed by ..."). Derived, so there is no column
      -- to drift: the display string cannot disagree with the attribution it is built from.
      COALESCE(l.listing_agent_name, l.broker_name) || ' – ' || l.office_name AS listed_by,

      -- PRD §6.3. A real listing can legitimately attach to a property row that originated from the
      -- seed, so the flag is the OR across every level that contributed a displayed fact — otherwise a
      -- fabricated address renders unlabelled under a real listing.
      (l.is_sample OR p.is_sample OR COALESCE(u.is_sample, false)) AS is_sample,

      EXISTS (
        SELECT 1 FROM listing_open_houses oh
        WHERE oh.listing_id = l.id AND NOT oh.is_cancelled
      )                                                     AS has_open_house,

      l.last_updated,
      l.created_at,
      l.updated_at
    FROM listings l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN units u ON u.id = l.unit_id
    WHERE l.deleted_at IS NULL
      -- RESO InternetEntireListingDisplayYN: the seller withheld the whole listing.
      AND l.internet_display_allowed
      -- Statuses the consumer product does not surface (Withdrawn, Expired, Canceled, Hold) are
      -- excluded here rather than in each caller's WHERE clause.
      AND l.consumer_status IS NOT NULL
      -- Bright's solds-display policy is a delay window measured from the close date, so a Closed
      -- listing with no close_date is not publishable. The window LENGTH needs the Bright content
      -- licence to set; until then the conservative rule is "must have a close date".
      AND (l.consumer_status <> 'Sold' OR l.close_date IS NOT NULL)
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS listing_search_v');
};
