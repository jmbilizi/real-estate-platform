exports.shorthands = undefined;

/**
 * `listing_open_houses`: open houses as rows, not columns.
 *
 * The previous shape was one `open_house_date` plus two `text` time columns on `listings`, which can
 * hold exactly ONE open house and cannot be compared or indexed as a time. RESO models open houses as
 * a separate multi-occurrence resource, and a listing with two weekends of showings is ordinary.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('listing_open_houses', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: 'listings',
      onDelete: 'CASCADE',
    },
    // Real instants, so "upcoming" is a comparison rather than a string parse.
    starts_at: { type: 'timestamptz', notNull: true },
    ends_at: { type: 'timestamptz', notNull: true },
    remarks: { type: 'text' },
    is_cancelled: { type: 'boolean', notNull: true, default: false },
    is_sample: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('listing_open_houses', 'listing_open_houses_ends_after_starts', {
    check: 'ends_at > starts_at',
  });

  pgm.createIndex('listing_open_houses', 'listing_id', {
    name: 'idx_listing_open_houses_listing_id',
  });
  pgm.createIndex('listing_open_houses', 'starts_at', {
    where: 'NOT is_cancelled',
    name: 'idx_listing_open_houses_starts_at',
  });

  pgm.createTrigger('listing_open_houses', 'listing_open_houses_set_updated_at', {
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
  pgm.dropTable('listing_open_houses');
};
