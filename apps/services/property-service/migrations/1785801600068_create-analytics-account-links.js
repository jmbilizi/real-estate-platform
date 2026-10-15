exports.shorthands = undefined;

/**
 * #827. `analytics_account_links`: which anonymous ids signed in to which account.
 *
 * Property service writes a row only after a verified sign-in. Account-service stays identity
 * only, so the link lives here, keyed by the account id. `account_id` has no foreign key because
 * accounts live in account-service's database. The table holds ids and two times. It holds no
 * email, phone or name.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('analytics_account_links', {
    account_id: { type: 'uuid', notNull: true },
    anon_id: { type: 'text', notNull: true },
    first_linked_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_linked_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('analytics_account_links', 'analytics_account_links_pk', {
    primaryKey: ['account_id', 'anon_id'],
  });
  // A funnel query joins events to accounts by anon id.
  pgm.createIndex('analytics_account_links', 'anon_id', {
    name: 'idx_analytics_account_links_anon_id',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('analytics_account_links');
};
