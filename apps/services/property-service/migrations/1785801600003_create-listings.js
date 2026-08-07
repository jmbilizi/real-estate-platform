exports.shorthands = undefined;

/**
 * `listing_statuses` + `listings`: one offer on a property (PRD §3, §3.1).
 *
 * A property may have zero or many listings across the years. Everything here is either an OFFER fact
 * (price, status, agency attribution, marketing copy) or a deliberate write-time SNAPSHOT of the
 * dwelling facts resolved from properties/units.
 *
 * Why the snapshot exists — two independent reasons:
 *   1. Search stays a single-table indexed query. Filtering on COALESCE(unit.x, property.x) spans two
 *      tables and cannot use an index on either, which would force every dwelling predicate in #22 to
 *      become a two-branch disjunction against base tables.
 *   2. A closed listing must keep rendering as it was ADVERTISED. A later renovation changes the
 *      dwelling; it must not retroactively rewrite what a 2019 sale claimed.
 *
 * The snapshot is one-way and derived. It has exactly one writer (`upsertListing()` in src/db) which
 * resolves it from durable truth, refuses to re-snapshot a terminal listing, and records
 * `snapshot_synced_at`. Nothing else may INSERT or UPDATE this table.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // --- Status vocabulary -----------------------------------------------------------------------
  // A lookup table, not a CHECK, because MLS status vocabularies change and a CHECK requires a
  // migration to extend. Seeded with the FULL RESO/Bright vocabulary rather than only the four the
  // client renders: a real feed sends 'Withdrawn' and 'Expired', and if those were not accepted the
  // upsert would be rejected and the previous Active row left untouched — i.e. we would keep
  // advertising a listing that is off the market.
  //
  // `consumer_status` maps a feed status onto the client's 4-value union, and is NULL for statuses the
  // consumer product does not surface. `is_publicly_searchable` is the display gate.
  pgm.createTable('listing_statuses', {
    code: { type: 'text', primaryKey: true },
    label: { type: 'text', notNull: true },
    consumer_status: {
      type: 'text',
      check:
        "consumer_status IS NULL OR consumer_status IN ('Active','Pending','Coming Soon','Sold')",
    },
    is_publicly_searchable: { type: 'boolean', notNull: true, default: false },
    counts_toward_dom: { type: 'boolean', notNull: true, default: false },
    is_terminal: { type: 'boolean', notNull: true, default: false },
    reso_standard_status: { type: 'text' },
    sort_order: { type: 'integer', notNull: true },
  });

  pgm.sql(`
    INSERT INTO listing_statuses
      (code, label, consumer_status, is_publicly_searchable, counts_toward_dom, is_terminal, reso_standard_status, sort_order)
    VALUES
      ('Active',                'Active',                'Active',      true,  true,  false, 'Active',                1),
      ('Coming Soon',           'Coming Soon',           'Coming Soon', true,  false, false, 'Coming Soon',           2),
      ('Active Under Contract', 'Active Under Contract',  'Pending',     true,  true,  false, 'Active Under Contract', 3),
      ('Pending',               'Pending',               'Pending',     true,  false, false, 'Pending',               4),
      ('Closed',                'Closed (Sold)',         'Sold',        true,  false, true,  'Closed',                5),
      ('Withdrawn',             'Withdrawn',             NULL,          false, false, true,  'Withdrawn',             6),
      ('Expired',               'Expired',               NULL,          false, false, true,  'Expired',               7),
      ('Canceled',              'Canceled',              NULL,          false, false, true,  'Canceled',              8),
      ('Hold',                  'Hold',                  NULL,          false, false, false, 'Hold',                  9),
      ('Temporarily Off Market','Temporarily Off Market', NULL,         false, false, false, 'Hold',                 10)
  `);

  pgm.createTable('listings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    // RESTRICT: sold listings are history that the Bright solds-display delay window and the §16
    // conversion metric depend on. The previous CASCADE meant replacing a property erased it.
    property_id: {
      type: 'uuid',
      notNull: true,
      references: 'properties',
      onDelete: 'RESTRICT',
    },
    // NULL means "the offer is the whole property", never "unknown".
    unit_id: {
      type: 'uuid',
      notNull: false,
      references: 'units',
      onDelete: 'RESTRICT',
    },

    // --- Display ---------------------------------------------------------------------------------
    title: { type: 'text', notNull: true },

    // --- Classification --------------------------------------------------------------------------
    // `offer_kind` is the record: what kind of offer this is. The previous 3-value listing_type
    // conflated that with lifecycle, so both 'sale'+Sold and 'sold'+Active were representable and a
    // sold RENTAL was unrepresentable. The client's published 3-value union is preserved exactly, as a
    // generated column that cannot contradict the status.
    offer_kind: {
      type: 'text',
      notNull: true,
      check: "offer_kind IN ('sale','rent')",
    },
    // Snapshot of listing_statuses.consumer_status for this row's status, written by upsertListing().
    // A plain column rather than a join so the view stays single-table and this stays indexable; a
    // generated column cannot reference another table.
    consumer_status: {
      type: 'text',
      check:
        "consumer_status IS NULL OR consumer_status IN ('Active','Pending','Coming Soon','Sold')",
    },
    listing_type: {
      type: 'text',
      expressionGenerated: "CASE WHEN consumer_status = 'Sold' THEN 'sold' ELSE offer_kind END",
    },
    status: {
      type: 'text',
      notNull: true,
      references: 'listing_statuses',
      onDelete: 'RESTRICT',
    },

    // --- Provenance ------------------------------------------------------------------------------
    // Stays listing-scoped and never hoisted: the same physical home can carry a brightMLS listing and
    // an internal FSBO record simultaneously, and internal data must never present as MLS-sourced
    // (PRD §6.2).
    source: {
      type: 'text',
      notNull: true,
      check: "source IN ('brightMLS','internal','other')",
    },
    // RESO OriginatingSystemName. The `source` enum above is the consumer-facing discriminator the
    // client type depends on; this is the per-MLS identity, so onboarding a second MLS is data rather
    // than a CHECK edit (PRD forbids hard-coding one market/MLS).
    source_system: { type: 'text' },
    // RESO ListingKey — unique per originating system, and the idempotency key for feed re-ingest.
    source_listing_key: { type: 'text' },
    // RESO ListingId — the human-facing MLS number. Deliberately separate from the key.
    source_listing_id: { type: 'text' },
    source_modification_timestamp: { type: 'timestamptz' },

    // --- Money -----------------------------------------------------------------------------------
    // Bounded numeric: a bare `numeric` accepts 1295000.0000000001 and gives the planner no width.
    // NOTE: node-postgres returns numeric as a STRING; src/db/pool.ts registers a parser so the API
    // emits a number and sorting is not lexicographic.
    list_price: { type: 'numeric(14,2)', notNull: true },
    original_list_price: { type: 'numeric(14,2)' },
    // A sale price must not overwrite the ask, and the Bright solds-display policy is a delay window
    // measured from the close date — there is no other column that could implement it.
    close_price: { type: 'numeric(14,2)' },
    close_date: { type: 'date' },

    // --- Dwelling snapshot (derived; see the file header) -----------------------------------------
    beds: { type: 'integer' },
    baths_full: { type: 'integer' },
    baths_half: { type: 'integer' },
    baths_display: {
      type: 'numeric(4,1)',
      expressionGenerated:
        'CASE WHEN baths_full IS NULL AND baths_half IS NULL THEN NULL ' +
        'ELSE COALESCE(baths_full, 0) + 0.5 * COALESCE(baths_half, 0) END',
    },
    living_sqft: { type: 'integer' },
    lot_sqft: { type: 'integer' },
    year_built: { type: 'integer' },
    neighborhood: { type: 'text' },
    city: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true },
    zip5: { type: 'text', notNull: true },
    latitude: { type: 'double precision' },
    longitude: { type: 'double precision' },
    // When the dwelling snapshot was last resolved from durable truth. A value older than the durable
    // rows' updated_at means deliberately frozen (terminal status) rather than forgotten.
    //
    // Defaulted rather than written by the insert on purpose: it keeps the writer's INSERT fully
    // parameterised. A literal like now() sitting in a VALUES list consumes no placeholder, which
    // silently shifts every column after it out of step with its bound value.
    snapshot_synced_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },

    // --- Marketing copy --------------------------------------------------------------------------
    // Third-party content we publish but did not write, so it needs provenance and a suppression state
    // rather than silent editing: MLS rules bar altering feed data while Fair Housing makes us liable
    // for what we display. A feed remark of "quiet, safe block — great for families, top schools"
    // contains three phrases the repo's own compliance rules flag as steering.
    description: { type: 'text' },
    description_source: {
      type: 'text',
      check:
        "description_source IS NULL OR description_source IN ('mls_remarks','agent','internal')",
    },
    description_moderation: {
      type: 'text',
      notNull: true,
      default: 'approved',
      check: "description_moderation IN ('pending','approved','suppressed')",
    },
    description_moderated_by: { type: 'text' },
    description_moderated_at: { type: 'timestamptz' },
    description_moderation_reason: { type: 'text' },

    // Closed set enforced in the DATABASE, not only in app code: an ingestion mapper or a manual SQL
    // fix bypassing transform.ts could otherwise persist an unreviewable steering phrase here. There is
    // deliberately no open `keywords`/`tags`/`features` column for the same reason.
    amenities: {
      type: 'text[]',
      notNull: true,
      default: '{}',
      check:
        "amenities <@ ARRAY['Pool','Garage','Gym','Elevator','Balcony','Fireplace','Washer/Dryer'," +
        "'Pet Friendly','Waterfront','Office','Rooftop','Garden','Smart Home','Solar','EV Charging']::text[]",
    },

    // --- Merchandising ---------------------------------------------------------------------------
    featured: { type: 'boolean', notNull: true, default: false },
    // Why this listing is featured. Editorial and algorithmic placement are ordinary product; PAID
    // placement requires a Sponsored disclosure (PRD §6), so the reason has to be recorded to be
    // disclosable at render time.
    featured_reason: {
      type: 'text',
      check: "featured_reason IS NULL OR featured_reason IN ('editorial','algorithmic','paid')",
    },
    price_reduced: { type: 'boolean', notNull: true, default: false },
    new_construction: { type: 'boolean', notNull: true, default: false },

    // --- Required attribution (MLS / NAR 7.58) ---------------------------------------------------
    // NOT NULL and never hoisted to the property: a 2026 relisting has a different agent than the 2019
    // sale, so a property-level copy would render the wrong firm on a new offer.
    broker_name: { type: 'text', notNull: true },
    broker_phone: { type: 'text', notNull: true },
    broker_email: { type: 'text', notNull: true },
    office_name: { type: 'text', notNull: true },
    office_broker_lead_phone: { type: 'text' },
    office_broker_lead_email: { type: 'text' },
    // Structured listing-agent identity. PRD §3.2's automatic `listing_agent` claim tier matches the
    // agent's verified licence/MLS ID against the feed; without an ID it degrades to name matching,
    // which is self-approval by naming yourself identically to the listing agent.
    listing_agent_name: { type: 'text' },
    listing_agent_mls_id: { type: 'text' },
    listing_agent_license: { type: 'text' },

    // --- Seller display suppression (RESO InternetEntireListingDisplayYN / InternetAddressDisplayYN)
    // Enforced by listing_search_v, which masks the address AND the coordinates — publishing the point
    // would re-identify the address the seller opted out of.
    internet_display_allowed: { type: 'boolean', notNull: true, default: true },
    address_display_allowed: { type: 'boolean', notNull: true, default: true },

    // --- Provenance / lifecycle ------------------------------------------------------------------
    is_sample: { type: 'boolean', notNull: true, default: false },
    // Invalidation key for derived artifacts (embeddings, generated summaries). Required because an
    // MLS sync rewrites rows wholesale, so `updated_at` moves on every poll whether or not the content
    // changed — keying invalidation on a timestamp would re-embed the entire corpus each sync.
    content_hash: { type: 'text' },
    // Soft delete: #22 must 404 removed listings and #23's saved rows must degrade rather than break a
    // foreign key.
    deleted_at: { type: 'timestamptz' },
    // MLS feed freshness. Deliberately distinct from updated_at and deliberately NOT on the trigger.
    last_updated: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('listings', 'listings_close_price_requires_close_date', {
    check: 'close_price IS NULL OR close_date IS NOT NULL',
  });

  // Idempotent feed re-ingest. Partial because internal/FSBO listings have no MLS key, and NULLs would
  // otherwise collide under a plain unique index.
  pgm.createIndex('listings', ['source_system', 'source_listing_key'], {
    unique: true,
    where: 'source_listing_key IS NOT NULL',
    name: 'idx_listings_source_key',
  });

  pgm.createIndex('listings', 'property_id', { name: 'idx_listings_property_id' });
  pgm.createIndex('listings', 'unit_id', { name: 'idx_listings_unit_id' });
  pgm.createIndex('listings', 'status', { name: 'idx_listings_status' });
  pgm.createIndex('listings', 'consumer_status', { name: 'idx_listings_consumer_status' });
  pgm.createIndex('listings', 'listing_type', { name: 'idx_listings_listing_type' });
  pgm.createIndex('listings', 'list_price', { name: 'idx_listings_list_price' });
  pgm.createIndex('listings', ['city', 'state', 'zip5'], { name: 'idx_listings_city_state_zip' });
  pgm.createIndex('listings', 'beds', { name: 'idx_listings_beds' });
  pgm.createIndex('listings', 'last_updated', { name: 'idx_listings_last_updated' });
  pgm.createIndex('listings', ['property_id', 'close_date'], {
    name: 'idx_listings_property_close_date',
  });
  pgm.createIndex('listings', 'amenities', { method: 'gin', name: 'idx_listings_amenities' });
  pgm.createIndex('listings', [{ name: 'neighborhood', opclass: 'gin_trgm_ops' }], {
    method: 'gin',
    name: 'idx_listings_neighborhood_trgm',
  });
  // Live inventory is the overwhelming majority of reads.
  pgm.createIndex('listings', ['consumer_status', 'list_price'], {
    where: 'deleted_at IS NULL AND internet_display_allowed',
    name: 'idx_listings_live_price',
  });

  pgm.createTrigger('listings', 'listings_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('listings');
  pgm.dropTable('listing_statuses');
};
