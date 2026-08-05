exports.shorthands = undefined;

/**
 * `units`: optional subdivision of a property (e.g. an apartment unit);
 * single-family homes/townhomes have no rows here (PRD §3).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('units', {
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
    unit_number: { type: 'text' },
    floor: { type: 'integer' },
    sqft: { type: 'integer' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('units', 'property_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('units');
};
