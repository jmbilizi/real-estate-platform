exports.shorthands = undefined;

/**
 * Extends the seller address opt-out to the three FREE-TEXT fields on the same row (#59).
 *
 * `listing_search_v` masked `address`, `latitude` and `longitude` together on
 * `address_display_allowed`, and `applyAddressSuppression()` nulled `unit.unitNumber` on the same
 * condition. But `title`, `description` and `open_house_remarks` were not conditioned on it at all —
 * `description` was gated only on `description_moderation`, the other two on nothing.
 *
 * A feed-authored title of the form `"142 Oak St — Colonial"` on an address-suppressed listing would
 * therefore both DISPLAY the withheld street line and restore the confirmation oracle that routing
 * the `street=` filter through the masked `address` column was specifically built to close: a caller
 * could search the real street line, match on `title`, and get back a row whose `address` is null —
 * confirming the exact address the seller opted out of. Same for remarks, which are commonly written
 * as "park on the corner of Oak and 3rd, entrance at the rear of 142".
 *
 * Latent today (no seeded row carries a street number in its title), and it opens the moment real
 * MLS ingestion lands — i.e. it will be opened by a ticket whose author has no reason to be thinking
 * about this view. That is exactly why it belongs in the view rather than in a caller's discipline.
 *
 * ONE PREDICATE, NOT A SECOND COPY OF THE RULE. Every suppression below is `l.address_display_allowed`
 * — the same column, the same sense — so there is one compliance decision with six consequences
 * rather than six rules that must be kept in agreement. `description` ANDs its existing
 * `description_moderation = 'approved'` gate onto it rather than replacing it: the two withhold copy
 * for unrelated reasons and BOTH must hold for the description to publish.
 *
 * --- The `title` decision (AC 2), and why the other option was rejected -------------------------
 *
 * `title` is not optional the way a description is: a card with no title does not render, and the
 * contract declares `title: z.string()` — NOT nullable — so nulling it would fail
 * `listingCardSchema.parse()` in `map-row.ts` and turn every suppressed listing into a 500. So the
 * view SUBSTITUTES rather than withholds.
 *
 * The substitute is built only from `property_type`, `city` and `state` — three columns this same
 * view already publishes UNMASKED on the very same row, and which the card already renders. It
 * therefore discloses nothing the caller did not already have, and it fabricates nothing: like
 * `listed_by` below, it is derived, so there is no stored column to drift out of agreement with it.
 * All three are `NOT NULL` in their tables (`listings.city`, `listings.state`,
 * `properties.property_type`), so the concatenation cannot silently evaluate to NULL and reintroduce
 * the missing-title problem by another route.
 *
 * The alternative AC 2 offered — enforce at the ingest boundary that a suppressed listing's title
 * may not contain the street line, leaving the view alone — was rejected on three grounds. It puts a
 * third copy of the compliance rule outside the view, against this service's standing rule that the
 * decision lives here. It covers `title` only, so `description` and `open_house_remarks` would still
 * need this migration anyway. And it would rest on substring-matching a street line inside free text
 * ("142 Oak St" vs "142 Oak Street" vs "142 Oak"), which fails open on exactly the inputs a real
 * feed produces. There is also nothing to build it into: ingestion does not exist yet, so choosing
 * that option would have meant shipping nothing.
 *
 * WHAT IS DELIBERATELY NOT SUPPRESSED. `open_house_starts_at`/`open_house_ends_at` stay: a time does
 * not identify an address, and withholding the schedule of a showing a consumer can attend would
 * remove inventory from the market rather than mask it — the opt-out is a mask on display, not a
 * removal. `is_sample` stays too, so the client's sample badge (`ListingCard.tsx` renders it from
 * `isSample`, not from the title text) still renders on a suppressed sample row even though the
 * substituted title no longer carries the dataset's `(Sample)` suffix. The badge is the structural
 * carrier of that label; the suffix is a convention on the stored data, which this does not touch.
 *
 * THIS VIEW IS NOT THE WHOLE FIX. `GET /listings/{id}` builds `listing.openHouses[]` from a
 * `json_agg` over `listing_open_houses` in `src/listings/repository.ts`, which never passes through
 * this view — so the remarks masked here are still reachable there. That half is handled by
 * `applyAddressSuppression()` in `src/listings/suppression.ts`, the one named response boundary, for
 * the same reason `unit.unitNumber` is: it is something the view structurally cannot reach.
 *
 * DROP + CREATE, and a new file rather than an edit to 009/010: applied migrations are immutable
 * (`pgmigrations` keys them by filename, with no checksum), and `CREATE OR REPLACE` cannot change a
 * view column's expression when the column list is being rewritten.
 *
 * Everything else below is migration 010's body, unchanged.
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

      -- #59. Substituted, not withheld: the contract's \`title\` is non-nullable and a card with no
      -- title does not render. Built only from columns this same row already publishes unmasked.
      CASE
        WHEN l.address_display_allowed THEN l.title
        ELSE p.property_type || ' in ' || l.city || ', ' || l.state
      END                                                   AS title,

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

      -- Suppressed copy must not reach a consumer payload at all. #59 adds the address predicate
      -- alongside the moderation one — they withhold copy for unrelated reasons and BOTH must hold
      -- before a description publishes.
      CASE
        WHEN l.address_display_allowed AND l.description_moderation = 'approved'
        THEN l.description
      END                                                   AS description,
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
      --
      -- #59: the TIMES are not suppressed — a time does not identify an address, and withholding a
      -- showing a consumer can attend removes inventory from the market rather than masking it. The
      -- REMARKS are, because they routinely name cross streets and house numbers.
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
 * Restores migration 010's view verbatim — seller-authored `title`, ungated `description` and
 * ungated `open_house_remarks` and all. A `down` that "improved" on what it is reverting to would
 * make the rollback path untestable, the same reasoning 009 and 010 give.
 *
 * **RUNNING THIS RE-OPENS A SELLER PRIVACY LEAK**, for the same reason 010's `down` does and with
 * the same consequence: a feed-authored title or open-house remark naming the street line publishes
 * again on a listing whose seller opted out of internet address display, and the free-text `query`
 * confirmation oracle comes back with it. Never run `migrate-down` past this migration against an
 * environment holding real or fixture opt-out data without re-applying the `up` immediately. The
 * project's documented recovery path is dropping and recreating `property_db`, not walking
 * migrations backwards; prefer it.
 *
 * `tests/listing-search-view.e2e.spec.ts` queries the REAL view and so fails against any database
 * left in this state; `src/listings/listing-search-view.spec.ts` runs in CI and fails if a future
 * migration's `up` drops one of the gates.
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
