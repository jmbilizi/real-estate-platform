exports.shorthands = undefined;

/**
 * `looking_for_preferences`: the "What I'm looking for" preferences of an account (#768).
 *
 * The client picks `id`. The key is `(account_id, id)`, so an id never collides across accounts
 * and a request never reaches another account's row. `account_id` has no foreign key: accounts live
 * in account-service's database. A preference belongs to the account, never to a role (PRD §11.2).
 * The limit of 5 per account is enforced in `src/looking-for/store.ts`, under an advisory lock.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('looking_for_preferences', {
    account_id: { type: 'uuid', notNull: true },
    id: { type: 'uuid', notNull: true },
    intent: { type: 'text', notNull: true, check: "intent IN ('buy', 'rent')" },
    places: { type: 'jsonb', notNull: true },
    price_min: { type: 'integer' },
    price_max: { type: 'integer' },
    beds_min: { type: 'integer' },
    baths_min: { type: 'integer' },
    home_types: { type: 'text[]', notNull: true, default: pgm.func("'{}'") },
    when_start: { type: 'date' },
    when_end: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('looking_for_preferences', 'looking_for_preferences_pkey', {
    primaryKey: ['account_id', 'id'],
  });

  pgm.addConstraint('looking_for_preferences', 'looking_for_preferences_when_check', {
    check: 'when_end IS NULL OR (when_start IS NOT NULL AND when_end >= when_start)',
  });

  pgm.sql(
    'CREATE INDEX idx_looking_for_preferences_account_recent ON looking_for_preferences (account_id, updated_at DESC, id DESC)',
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('looking_for_preferences');
};
