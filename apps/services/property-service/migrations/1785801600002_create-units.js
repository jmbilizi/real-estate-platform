exports.shorthands = undefined;

/**
 * `units`: an OPTIONAL subdivision of a property (PRD §3) — an apartment or condo unit inside a
 * building that we hold as more than one dwelling.
 *
 * Single-family homes and townhomes have no rows here; their dwelling facts live on `properties`
 * (see 001). This keeps PRD §3's "optional for single-family homes" literally true and avoids
 * synthetic placeholder rows for houses and vacant land.
 *
 * When a unit row exists it is the system of record for that unit's dwelling facts, and resolution is
 * exactly one level deep: COALESCE(unit.x, property.x).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('units', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    // RESTRICT, not CASCADE. property_id/unit_id are a cross-service contract held as bare UUIDs by
    // claims (PRD §3.2), Connect posts (§8), and service requests (§5.8), and a CASCADE from a
    // property refresh would silently delete rows those references depend on. Merges become alias
    // rows, never deletions.
    property_id: {
      type: 'uuid',
      notNull: true,
      references: 'properties',
      onDelete: 'RESTRICT',
    },
    unit_number: { type: 'text' },
    floor: { type: 'integer' },
    // Floorplan/unit-type name. Present now so the rental floorplan level can be extracted later
    // without reshaping this table.
    unit_type: { type: 'text' },

    // Dwelling facts for this unit — the same shape as `properties` so resolution is a plain COALESCE.
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

  // NULLS NOT DISTINCT so two feeds cannot create unit '4B' twice, and so at most one row with a NULL
  // unit_number can exist per property. Only expressible via createIndex — addConstraint has no such
  // option.
  pgm.createIndex('units', ['property_id', 'unit_number'], {
    unique: true,
    nulls: 'not distinct',
    name: 'idx_units_property_id_unit_number',
  });

  pgm.createTrigger('units', 'units_set_updated_at', {
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
  pgm.dropTable('units');
};
