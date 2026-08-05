exports.shorthands = undefined;

/**
 * `listings`: the full consumer listing model (PRD §3.1) linked to a
 * `property_id` and optionally a `unit_id`. `pg_trgm` is already enabled on
 * `property_db` — used here for a fuzzy-search-friendly GIN index on
 * `neighborhood`, which is why that extension was provisioned in the first
 * place.
 *
 * Property-relationship claims (PRD §3.2) are explicitly out of scope for
 * this migration/ticket.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createExtension('pg_trgm', { ifNotExists: true });

  pgm.createTable('listings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    property_id: {
      type: 'uuid',
      notNull: true,
      references: 'properties',
      onDelete: 'CASCADE',
    },
    unit_id: {
      type: 'uuid',
      notNull: false,
      references: 'units',
      onDelete: 'SET NULL',
    },

    // Display
    // Consumer-facing headline. The web client renders this on listing cards,
    // the detail gallery, and map pins (`Listing.title` in
    // apps/clients/cribstop/next/src/lib/types.ts), so it has to persist here
    // for #24 to be a data-source swap rather than a rewrite.
    title: { type: 'text', notNull: true },

    // Classification
    listing_type: {
      type: 'text',
      notNull: true,
      check: "listing_type IN ('sale','rent','sold')",
    },
    source: {
      type: 'text',
      notNull: true,
      check: "source IN ('brightMLS','internal','other')",
    },
    status: {
      type: 'text',
      notNull: true,
      check: "status IN ('Active','Pending','Coming Soon','Sold')",
    },

    // Core attributes
    price: { type: 'numeric', notNull: true },
    beds: { type: 'integer' },
    baths: { type: 'numeric' }, // supports halves, e.g. 2.5
    sqft: { type: 'integer' },
    lot_sqft: { type: 'integer' },
    year_built: { type: 'integer' },
    neighborhood: { type: 'text' },
    city: { type: 'text' },
    state: { type: 'text' },
    zip: { type: 'text' },
    latitude: { type: 'double precision' },
    longitude: { type: 'double precision' },
    image_urls: { type: 'text[]' },
    description: { type: 'text' },
    amenities: { type: 'text[]' }, // validated app-side against the fixed Amenity enum

    // Merchandising flags
    featured: { type: 'boolean', notNull: true, default: false },
    price_reduced: { type: 'boolean', notNull: true, default: false },
    new_construction: { type: 'boolean', notNull: true, default: false },
    open_house_date: { type: 'date' },
    open_house_start_time: { type: 'text' },
    open_house_end_time: { type: 'text' },

    // Required attribution block (MLS/brokerage compliance)
    broker_name: { type: 'text', notNull: true },
    broker_phone: { type: 'text', notNull: true },
    broker_email: { type: 'text', notNull: true },
    office_name: { type: 'text', notNull: true },
    office_broker_lead_phone: { type: 'text' },
    office_broker_lead_email: { type: 'text' },

    // Sample/dev data marker (PRD §6.3 — sample data must be clearly labelled and
    // never presented as real inventory). Seeded rows set this true; real
    // listings ingested later default to false. Gives clients a machine-checkable
    // predicate for a "Sample data" badge, and prod a trivial audit assertion.
    is_sample: { type: 'boolean', notNull: true, default: false },

    last_updated: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('listings', 'property_id');
  pgm.createIndex('listings', 'status');
  pgm.createIndex('listings', ['city', 'state', 'zip']);
  pgm.createIndex('listings', [{ name: 'neighborhood', opclass: 'gin_trgm_ops' }], {
    method: 'gin',
    name: 'idx_listings_neighborhood_trgm',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('listings');
};
