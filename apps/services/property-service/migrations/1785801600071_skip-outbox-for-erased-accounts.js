exports.shorthands = undefined;

/**
 * Erased-account guard (#1006). Erasure keeps the lead (PRD §6.4), and the lead keeps its consent
 * evidence. A later status event could then queue a new buyer row for the erased account.
 *
 * - `erased_accounts` holds the id of each erased account. It holds no other data.
 * - A BEFORE INSERT trigger on `notification_outbox` drops a row whose recipient is in that table.
 *   It covers every writer, including one not yet written.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('erased_accounts', {
    account_id: { type: 'uuid', primaryKey: true },
    erased_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`
    CREATE FUNCTION notification_outbox_skip_erased() RETURNS trigger AS $$
    BEGIN
      IF NEW.recipient_account_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM erased_accounts WHERE account_id = NEW.recipient_account_id
      ) THEN
        RETURN NULL;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    CREATE TRIGGER notification_outbox_skip_erased
      BEFORE INSERT ON notification_outbox
      FOR EACH ROW EXECUTE FUNCTION notification_outbox_skip_erased()
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER notification_outbox_skip_erased ON notification_outbox');
  pgm.sql('DROP FUNCTION notification_outbox_skip_erased()');
  pgm.dropTable('erased_accounts');
};
