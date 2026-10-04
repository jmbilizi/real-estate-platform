exports.shorthands = undefined;

/**
 * `saved_homes`: the homes an account saved (#23).
 *
 * `property_id` is the HOME id of #386, the same value the contract calls `propertyId`: the unit id
 * in a subdivided building, else the property id. A save keys on the home, never on the listing,
 * because Bright creates a new listing row when the listing agreement changes. A listing-keyed save
 * would detach from the home the consumer saved. The column has no foreign key because the value
 * names a row in one of two tables.
 *
 * `listing_id` records the listing the consumer was looking at. It is context only. It is not part
 * of the unique key and no read uses it to find a save. `ON DELETE SET NULL` keeps a listing
 * delete from blocking or orphaning a save.
 *
 * `account_id` has no foreign key. Accounts live in account-service's database. A save belongs to
 * the account, never to a role (PRD §11.2).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('saved_homes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    account_id: { type: 'uuid', notNull: true },
    property_id: { type: 'uuid', notNull: true },
    listing_id: { type: 'uuid', references: 'listings', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('saved_homes', 'saved_homes_account_property_unique', {
    unique: ['account_id', 'property_id'],
  });

  // The list endpoint pages one account's saves, newest first.
  pgm.sql(
    'CREATE INDEX idx_saved_homes_account_recent ON saved_homes (account_id, created_at DESC, id DESC)',
  );

  pgm.createIndex('saved_homes', 'listing_id', {
    name: 'idx_saved_homes_listing_id',
    where: 'listing_id IS NOT NULL',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('saved_homes');
};
