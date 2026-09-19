exports.shorthands = undefined;

/**
 * #53. Bright lets a seller suppress price, photos, days on market and price history
 * individually while the listing stays syndicated (public announcement, 2026-07-09). The two
 * existing booleans (`internet_display_allowed`, `address_display_allowed`) cannot express "show
 * this listing, price withheld" — this migration adds the remaining flags in this service's own
 * idiom, never Bright's field names. #146 maps Bright's fields onto them later, once #33 item
 * 9(f) confirms the semantics in writing; nothing here assumes a Bright field name or value.
 *
 * WHAT EACH FLAG MASKS, AND WHAT IT DOES NOT.
 *   - `price_display_allowed` masks `price` (the list/rent price) alone.
 *   - `price_history_display_allowed` masks `original_list_price` AND forces `price_reduced` to
 *     false. The two travel together: a suppressed original price with an un-suppressed
 *     "reduced" flag still discloses that a price change happened, which is the fact a seller
 *     opting out of price-history display means to withhold.
 *   - `days_on_market_display_allowed` masks the new `days_on_market` column.
 *   - `media_display_allowed` masks no `listings` column. It gates the media selection in
 *     `src/listings/repository.ts`: false means "select ONLY the `listing_media` row
 *     `retained_when_suppressed` marks, never one chosen by `sort_order`/`is_primary`, and none
 *     at all if no row is marked." See that file for why the mechanism lives there and not here.
 *
 * WHY EXPLICIT COLUMNS RATHER THAN THE #127 REGISTRY. #127's governed field + lookup registry is
 * for values discovered from an open feed vocabulary (RESO status codes, condition strings).
 * These four facts are a closed, per-listing yes/no, exactly like the two existing flags, so a
 * fifth boolean family costs one column and one `CASE`, not a schema change to a registry row
 * shape. The registry stays the right tool for open vocabularies; this stays the right tool for a
 * small, closed set of per-listing switches.
 *
 * DEFAULT true, matching `internet_display_allowed`/`address_display_allowed`. An `ADD COLUMN`
 * default of `false` would suppress every already-seeded listing's price the moment this
 * migration runs: `seed-on-start.ts` re-seeds only on a MOCK DATASET content-hash change
 * (`dataset-hash.ts`), which this migration does not touch, so existing sample rows would keep
 * their backfilled default indefinitely. `ListingRow` makes all four required (not
 * optional-with-default) for the same reason the existing two flags are required — a future MLS
 * mapper that forgets to carry one must fail to compile, not publish a value the seller withheld.
 *
 * FAIL-CLOSED, STRUCTURALLY. All four columns are NOT NULL, so there is no representable
 * "unknown" state for a flag to default open by accident. The one place an omitted signal can
 * genuinely arise — a suppressed listing whose media replication pass has not run yet, so no row
 * is marked retained — is handled by construction in `repository.ts`: the query matches zero
 * rows rather than falling back to `is_primary`, asserted by
 * `src/listings/listing-search-view.spec.ts` and this migration's own header comment on
 * `retained_when_suppressed` below.
 *
 * RETAINED-PHOTO SEMANTICS ARE UNCONFIRMED PENDING #146. "Exactly one retained exterior photo"
 * comes from a trade-press description of Bright's photo-suppression behaviour (stakeholder
 * ruling 2026-09-16), not from #33 item 9(f) in writing. This migration and the mechanism it
 * enables are reviewed against that assumption; only #146's Bright field mapping is blocked on
 * written confirmation of the rule itself.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('listings', {
    price_display_allowed: { type: 'boolean', notNull: true, default: true },
    price_history_display_allowed: { type: 'boolean', notNull: true, default: true },
    media_display_allowed: { type: 'boolean', notNull: true, default: true },
    days_on_market_display_allowed: { type: 'boolean', notNull: true, default: true },
    // Not stored before this ticket. Nullable: unknown until a feed populates it, and an
    // internal/FSBO listing never carries MLS "days on market" at all.
    days_on_market: { type: 'integer' },
  });
  pgm.addConstraint('listings', 'listings_days_on_market_nonnegative', {
    check: 'days_on_market IS NULL OR days_on_market >= 0',
  });

  pgm.addColumn('listing_media', {
    // The explicit marker #146 sets from the feed's media pass. Never inferred from
    // `sort_order`/`is_primary` — see repository.ts's PRIMARY_MEDIA_JOIN and the detail media
    // join for the selection rule this drives.
    retained_when_suppressed: { type: 'boolean', notNull: true, default: false },
  });
  // At most one retained photo per listing, mirroring idx_listing_media_one_primary. Without
  // this, "exactly one retained photo" would be a query-time coincidence rather than a
  // guarantee, and repository.ts's WHERE-clause selection would need an ORDER BY/LIMIT it is
  // deliberately built not to need.
  pgm.createIndex('listing_media', 'listing_id', {
    unique: true,
    where: 'retained_when_suppressed',
    name: 'idx_listing_media_one_retained',
  });

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

      -- #53. Bright's seller-directed price suppression, independent of the address opt-out.
      CASE WHEN l.price_display_allowed THEN l.list_price END AS price,
      -- #53. "Price history" masks the ORIGINAL price and the reduced FLAG together — an
      -- unsuppressed price_reduced next to a masked original_list_price still discloses that a
      -- price change happened, which is what this opt-out means to withhold.
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
      -- #53. See original_list_price above: the two are one suppression decision.
      CASE
        WHEN l.price_history_display_allowed THEN l.price_reduced ELSE false
      END                                                   AS price_reduced,
      l.new_construction,

      -- #53. Not stored before this migration. Masked independently of price/price-history:
      -- Bright models it as its own opt-out.
      CASE
        WHEN l.days_on_market_display_allowed THEN l.days_on_market
      END                                                   AS days_on_market,

      -- #53. An INPUT to repository.ts's media selection, never a value to mask itself — see this
      -- migration's header. Deliberately not in FORBIDDEN_COLUMNS's sibling flags' company on the
      -- wire: nothing in columns.ts's enumerated CARD/DETAIL projections selects it, so it never
      -- reaches a mapper or the wire, only the ad hoc join SQL in repository.ts.
      l.media_display_allowed,

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
 * Restores migration 011's view verbatim and drops the columns this migration added.
 *
 * **RUNNING THIS RE-OPENS A SELLER PRIVACY LEAK** for price, price history and days on market, for
 * the same reason every prior view migration's `down` does: never run `migrate-down` past this
 * migration against an environment holding real or fixture suppressed data without re-applying
 * `up` immediately. The project's documented recovery path is dropping and recreating
 * `property_db`, not walking migrations backwards; prefer it.
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

  pgm.dropIndex('listing_media', 'listing_id', { name: 'idx_listing_media_one_retained' });
  pgm.dropColumn('listing_media', ['retained_when_suppressed']);
  pgm.dropConstraint('listings', 'listings_days_on_market_nonnegative');
  pgm.dropColumn('listings', [
    'price_display_allowed',
    'price_history_display_allowed',
    'media_display_allowed',
    'days_on_market_display_allowed',
    'days_on_market',
  ]);
};
