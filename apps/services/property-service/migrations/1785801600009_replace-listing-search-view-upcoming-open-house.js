exports.shorthands = undefined;

/**
 * Replaces `listing_search_v` so the open-house projection is time-bounded and carries the actual
 * occurrence instead of a boolean.
 *
 * Migration 007 projected `has_open_house` as `EXISTS (... WHERE NOT is_cancelled)` with **no time
 * bound**, so a listing whose only open house happened last March still matched. That is wrong for
 * #22's `openHouse` filter and wrong for `ListingCard`'s truthiness-based "Open house" badge — it
 * advertises a showing that already happened. Applied migrations are immutable (pgmigrations keys them
 * by filename, with no checksum), so the fix is a new migration rather than an edit to 007.
 *
 * **UPCOMING means `ends_at > now()`, deliberately not `starts_at > now()`.** An open house running
 * right now is the highest-value match in the whole dataset — a consumer can walk into it — so
 * excluding it is the more visible of the two possible bugs.
 *
 * Projecting the soonest such occurrence rather than a boolean is what lets ONE field serve the
 * filter, the badge and the card copy, which is why the contract carries `openHouse: {...} | null`
 * and structurally refuses a `hasOpenHouse`. `now()` inside a view is evaluated per query and is
 * transaction-scoped, so a search's COUNT and its page — which run inside one REPEATABLE READ READ
 * ONLY transaction — always see the same instant and cannot disagree about which rows match.
 *
 * DROP + CREATE rather than CREATE OR REPLACE: a replace can only append columns, never remove one,
 * and `has_open_house` must actually go. Leaving it would leave the wrong rule reachable by the next
 * caller who greps for it. Verified before writing this: nothing in the codebase selects that column.
 *
 * `street_line` deliberately stays exposed by this view. Removing it is **#48**; #22's callers
 * enumerate their columns and never select it, which is what keeps the unmasked value out of the API
 * process in the meantime. Do not fold #48 into this migration — the view is consumed by more than
 * one ticket's worth of decisions and #48 owns that one.
 *
 * Everything else below is migration 007's body, unchanged.
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

      -- The soonest UPCOMING occurrence, or NULLs together. Replaces 007's unbounded
      -- has_open_house boolean: see this migration's header for why the bound is ends_at, not
      -- starts_at, and why an occurrence rather than a flag.
      upcoming_open_house.starts_at                         AS open_house_starts_at,
      upcoming_open_house.ends_at                           AS open_house_ends_at,
      upcoming_open_house.remarks                           AS open_house_remarks,

      l.last_updated,
      l.created_at,
      l.updated_at
    FROM listings l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN units u ON u.id = l.unit_id
    -- Served by idx_listing_open_houses_upcoming (migration 008). Ordered by id as well as
    -- starts_at so two occurrences beginning at the same instant resolve deterministically instead
    -- of letting the plan decide which one the badge shows.
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
 * Restores migration 007's view verbatim, including the unbounded `has_open_house` boolean. A `down`
 * that "improved" on what it is reverting to would make the rollback path untestable.
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
      l.title,
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
      COALESCE(l.listing_agent_name, l.broker_name) || ' – ' || l.office_name AS listed_by,
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
      AND l.internet_display_allowed
      AND l.consumer_status IS NOT NULL
      AND (l.consumer_status <> 'Sold' OR l.close_date IS NOT NULL)
  `);
};
