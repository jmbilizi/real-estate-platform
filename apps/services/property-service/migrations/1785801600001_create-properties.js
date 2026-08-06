exports.shorthands = undefined;

/**
 * `properties`: the durable physical home (PRD §3).
 *
 * This table holds the facts that do not change when a listing does — the site (address, parcel,
 * geography, lot, structure class) AND the dwelling itself (beds, baths, living area) whenever the
 * property is not subdivided. A property is fully meaningful with ZERO listings, which is what PRD
 * §3.2 claims, §4.6 service history, and homeowner re-engagement all attach to.
 *
 * Dwelling facts live here for a single-family home, townhome, or any property held as one dwelling;
 * for a genuinely subdivided building they live on `units` instead (see 002). Resolution is exactly
 * one level deep: COALESCE(unit.x, property.x). `units` therefore stays optional, as PRD §3 states.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('properties', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    community_id: {
      type: 'uuid',
      notNull: false,
      references: 'communities',
      onDelete: 'SET NULL',
    },

    // --- Address, parsed for deduplication -----------------------------------------------------
    // PRD §6.2 mandates deduplication between MLS and internal records, and that cannot be done on a
    // single opaque address string: the same building arrives as '800 F Street NW' from one source and
    // '800 F St NW' from another. `address_raw` preserves the source string so a bad normalisation is
    // always re-derivable; `street_line` is the parsed street WITHOUT any unit designator (the unit
    // lives on `units`, so a display address is composed, never stored twice).
    address_raw: { type: 'text', notNull: true },
    street_line: { type: 'text', notNull: true },
    city: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true },
    zip5: { type: 'text', notNull: true },
    // Deterministic identity for one physical building. Computed in application code
    // (src/seed/address.ts) rather than as a generated column, because canonicalising USPS street
    // suffixes and directionals is not an IMMUTABLE SQL expression. The UNIQUE index below is what
    // makes a second listing on the same address attach to the same property instead of inventing a
    // new building.
    address_key: { type: 'text', notNull: true },

    // Durable external identity. Nullable: no public-records provider is contracted yet, and a
    // nullable column now is far cheaper than adding identity to a populated table later. Never
    // auto-merge two properties on these alone — see the deferred property_source_links note in the
    // project CLAUDE.md.
    apn: { type: 'text' },
    county_fips: { type: 'text' },

    // --- Location ------------------------------------------------------------------------------
    latitude: { type: 'double precision' },
    longitude: { type: 'double precision' },
    // Geography is derived, never independently written, so it can never disagree with the
    // coordinates. `expressionGenerated` emits GENERATED ALWAYS AS (...) STORED — on PostgreSQL 18 a
    // bare GENERATED column defaults to VIRTUAL and virtual columns cannot be indexed, so this option
    // (not hand-written SQL) is what makes the GiST index below possible.
    geog: {
      type: 'geography(Point,4326)',
      expressionGenerated:
        'CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL ' +
        'THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography END',
    },
    neighborhood: { type: 'text' },

    // --- Structure -----------------------------------------------------------------------------
    // notNull matters as much as the CHECK: a CHECK evaluates to UNKNOWN for NULL and therefore
    // passes, so without this a typeless property would slip through the enum entirely.
    property_type: {
      type: 'text',
      notNull: true,
      check:
        "property_type IN ('Single Family','Condo','Townhome','Multi-Family','Loft','Land','New Construction')",
    },
    year_built: { type: 'integer' },
    lot_sqft: { type: 'integer' },
    stories: { type: 'integer' },

    // --- Dwelling facts (present when the property is NOT subdivided) --------------------------
    // Split full/half rather than one numeric, because that is how MLS feeds supply bathrooms and a
    // single decimal cannot be decomposed back. `baths_display` is the consumer-facing 2.5 form.
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

    is_sample: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Every expression, opclass, or partial index gets an explicit name: node-pg-migrate otherwise
  // derives one from the raw expression, e.g. "properties_(lower(neighborhood))_index".
  pgm.createIndex('properties', 'address_key', {
    unique: true,
    name: 'idx_properties_address_key',
  });
  pgm.createIndex('properties', 'community_id', { name: 'idx_properties_community_id' });
  pgm.createIndex('properties', 'geog', { method: 'gist', name: 'idx_properties_geog' });
  pgm.createIndex('properties', ['city', 'state', 'zip5'], {
    name: 'idx_properties_city_state_zip',
  });
  pgm.createIndex('properties', 'property_type', { name: 'idx_properties_property_type' });
  pgm.createIndex('properties', 'apn', {
    where: 'apn IS NOT NULL',
    name: 'idx_properties_apn',
  });
  // The client's neighborhood filter is exact case-insensitive equality, so it needs a lower()
  // expression index — a trigram index cannot serve equality.
  pgm.createIndex('properties', 'lower(neighborhood)', {
    name: 'idx_properties_neighborhood_lower',
  });
  // The street substring filter is a LIKE/contains match, which is what pg_trgm is for.
  pgm.createIndex('properties', [{ name: 'street_line', opclass: 'gin_trgm_ops' }], {
    method: 'gin',
    name: 'idx_properties_street_line_trgm',
  });

  pgm.createTrigger('properties', 'properties_set_updated_at', {
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
  pgm.dropTable('properties');
};
