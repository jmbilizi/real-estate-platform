exports.shorthands = undefined;

/**
 * A lead keeps only the account id (#691). The buyer's name and email come from account-service
 * at read time, so a copy cannot go stale and we hold no personal data we do not need.
 *
 * - Drops `listing_inquiries.name`, `email` and `verified_account`. Phone, message, consent and
 *   `account_id` stay. The possible-duplicate index on `lower(btrim(email))` goes with the column.
 *   Its replacement matches the same listing, the same account and the creation time.
 * - Outbox: every recipient is an account id. An agent row held the agent profile id, so this
 *   maps it to the profile's `account_id`. `recipient_ref_type` has no purpose left and goes.
 *   `recipient_ref` becomes `recipient_account_id`.
 *
 * The down migration restores the columns empty. It restores no data.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS idx_listing_inquiries_dup_email');
  pgm.dropColumns('listing_inquiries', ['name', 'email', 'verified_account']);
  pgm.createIndex('listing_inquiries', ['listing_id', 'account_id', 'created_at'], {
    name: 'idx_listing_inquiries_dup_account',
  });

  pgm.sql(
    `UPDATE notification_outbox o
        SET recipient_ref = i.account_id
       FROM listing_inquiries i
      WHERE o.recipient_kind = 'buyer' AND o.lead_id = i.id`,
  );
  pgm.sql(
    `UPDATE notification_outbox o
        SET recipient_ref = p.account_id
       FROM agent_profiles p
      WHERE o.recipient_kind = 'agent' AND o.recipient_ref = p.id`,
  );
  pgm.sql(
    `DELETE FROM notification_outbox o
      WHERE o.recipient_kind = 'agent'
        AND NOT EXISTS (SELECT 1 FROM agent_profiles p WHERE p.account_id = o.recipient_ref)`,
  );
  pgm.dropConstraint('notification_outbox', 'notification_outbox_ref_type_check');
  pgm.dropColumn('notification_outbox', 'recipient_ref_type');
  pgm.renameColumn('notification_outbox', 'recipient_ref', 'recipient_account_id');
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.renameColumn('notification_outbox', 'recipient_account_id', 'recipient_ref');
  pgm.addColumn('notification_outbox', {
    recipient_ref_type: { type: 'text', notNull: true, default: 'account' },
  });
  pgm.alterColumn('notification_outbox', 'recipient_ref_type', { default: null });
  pgm.sql(
    `UPDATE notification_outbox o
        SET recipient_ref = p.id, recipient_ref_type = 'agent_profile'
       FROM agent_profiles p
      WHERE o.recipient_kind = 'agent' AND o.recipient_ref = p.account_id`,
  );
  pgm.addConstraint('notification_outbox', 'notification_outbox_ref_type_check', {
    check:
      "(recipient_kind = 'agent' AND recipient_ref_type = 'agent_profile') " +
      "OR (recipient_kind = 'buyer' AND recipient_ref_type IN ('account', 'lead'))",
  });

  pgm.dropIndex('listing_inquiries', ['listing_id', 'account_id', 'created_at'], {
    name: 'idx_listing_inquiries_dup_account',
  });
  pgm.addColumns('listing_inquiries', {
    name: { type: 'text', notNull: true, default: '' },
    email: { type: 'text', notNull: true, default: '' },
    verified_account: { type: 'boolean', notNull: true, default: false },
  });
  pgm.alterColumn('listing_inquiries', 'name', { default: null });
  pgm.alterColumn('listing_inquiries', 'email', { default: null });
  pgm.sql(
    `CREATE INDEX idx_listing_inquiries_dup_email
       ON listing_inquiries (listing_id, lower(btrim(email)), created_at)`,
  );
};
