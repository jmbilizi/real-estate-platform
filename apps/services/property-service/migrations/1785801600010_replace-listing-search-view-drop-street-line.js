exports.shorthands = undefined;

/**
 * Replaces `listing_search_v` so it no longer projects the unmasked `street_line` (#48).
 *
 * Migrations 007 and 009 both masked the address correctly and then handed out the raw street line
 * three lines later:
 *
 *     CASE WHEN l.address_display_allowed THEN p.street_line || ... END AS address,
 *     ...
 *     p.street_line,
 *
 * Every row the view returned — INCLUDING rows where the seller opted out of internet address
 * display (RESO `InternetAddressDisplayYN`) — carried the exact address the seller withheld. The
 * masked `latitude`/`longitude` beside it make the intent unambiguous: the view already recognised
 * that leaking either the address or its point defeats the opt-out.
 *
 * The view is this platform's SINGLE enforcement point for that opt-out precisely so that no caller
 * has to remember the rule. A column that must not be selected is a rule every future caller can
 * break silently — and #22's mitigation (enumerate columns, never `SELECT *`) is a discipline in one
 * service, not a guarantee of the read model. This migration makes the guarantee structural.
 *
 * `p.street_line` is still READ by the view: it is the input to the masked `address` expression.
 * What is gone is the bare projection. That distinction is what the static guard in
 * `src/listings/listing-search-view.spec.ts` asserts, and it is why "grep for street_line" is not a
 * sufficient review of this file.
 *
 * DROP + CREATE rather than CREATE OR REPLACE: a replace can only append columns to a view, never
 * remove one, so `CREATE OR REPLACE` fails outright here ("cannot drop columns from view"). Applied
 * migrations are immutable (`pgmigrations` keys them by filename, with no checksum), so 007 and 009
 * are left exactly as they are and this appends instead.
 *
 * Nothing selected the removed column. Verified before writing this: `street_line` appears in this
 * service only in `properties`' own DDL, `src/db/write.ts`'s INSERT, the seed transform, and
 * `FORBIDDEN_COLUMNS` — which keeps naming it deliberately, as defence in depth against a future
 * migration re-adding it. `street` and free-text `query` filters already match the MASKED `address`
 * column (`src/listings/search-query.ts`), so the confirmation-oracle property #22 built holds
 * unchanged: there is no longer any column to filter the raw line against at all.
 *
 * Everything else below is migration 009's body, unchanged.
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
      --
      -- #48: p.street_line is an INPUT to this expression and is deliberately NOT projected on its
      -- own below. Re-adding a bare \`p.street_line\` column would hand every caller of this view the
      -- address this CASE exists to withhold.
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
      -- has_open_house boolean: see migration 009's header for why the bound is ends_at, not
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
 * Restores migration 009's view verbatim, unmasked `street_line` and all. A `down` that "improved"
 * on what it is reverting to would make the rollback path untestable — the same reasoning 009 gives
 * for restoring 007's `has_open_house` boolean.
 *
 * **RUNNING THIS RE-OPENS A SELLER PRIVACY LEAK.** Unlike an ordinary schema rollback, this one
 * reinstates the exact defect the `up` above closed: every row of `listing_search_v` — including
 * rows where the seller opted out of internet address display (RESO `InternetAddressDisplayYN`) —
 * goes back to carrying the raw `street_line` beside the masked `address`. Nothing in
 * `node-pg-migrate` warns about that at the point of execution, which is why it is stated here.
 *
 * So: never run `migrate-down` past this migration against any environment holding real or fixture
 * opt-out data unless the `up` is re-applied immediately afterwards. This is not a theoretical
 * concern — no filename changed to get here (010 only appends), so `migrate-down` will succeed
 * rather than refusing the way the project guide describes for renamed migrations. The project's
 * documented recovery path is dropping and recreating `property_db`, not walking migrations
 * backwards; prefer it.
 *
 * Deliberately NOT special-cased in the `migrate-down` target: `node-pg-migrate` offers no
 * per-migration refusal hook, and teaching the runner about one migration by name is a maintenance
 * trap that the next view migration would silently outgrow. Two guards cover the two ways the leak
 * can come back: `src/listings/listing-search-view.spec.ts` runs in CI and fails if a future
 * migration's `up` re-adds the projection, and `tests/listing-search-view.e2e.spec.ts` queries the
 * REAL view and so fails against any database left in the rolled-back state — however it got there.
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
      upcoming_open_house.starts_at                         AS open_house_starts_at,
      upcoming_open_house.ends_at                           AS open_house_ends_at,
      upcoming_open_house.remarks                           AS open_house_remarks,
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
