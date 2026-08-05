exports.shorthands = undefined;

/**
 * `properties`: physical building or standalone home related to one
 * community (PRD §3). `community_id` is nullable — a property can exist
 * without a managing community.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('properties', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    community_id: {
      type: 'uuid',
      notNull: false,
      references: 'communities',
      onDelete: 'SET NULL',
    },
    address: { type: 'text', notNull: true },
    city: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true },
    zip: { type: 'text', notNull: true },
    latitude: { type: 'double precision' },
    longitude: { type: 'double precision' },
    // notNull matters as much as the CHECK: a CHECK evaluates to UNKNOWN for
    // NULL and therefore passes, so without this a typeless property would slip
    // through the enum constraint entirely. Every property has a type (the web
    // client's Listing.propertyType is required), so NULL is never legitimate.
    property_type: {
      type: 'text',
      notNull: true,
      check:
        "property_type IN ('Single Family','Condo','Townhome','Multi-Family','Loft','Land','New Construction')",
    },
    year_built: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('properties', 'community_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('properties');
};
