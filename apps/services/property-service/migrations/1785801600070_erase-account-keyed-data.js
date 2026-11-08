exports.shorthands = undefined;

/**
 * Account erasure (#992).
 *
 * - `notification_outbox.recipient_account_id` allows NULL. A sent row keeps its place with no
 *   recipient.
 * - `agent_profiles.account_id` allows NULL and `deactivated_at` is new. Erasure pseudonymises the
 *   profile and keeps the row, because the brokerage record names the licensee for 5 years. The
 *   CHECK ties the two columns together: a row with no account is inactive and has a
 *   `deactivated_at`, and a row with `deactivated_at` has no account.
 * - `lead_assignments`, `lead_status_events` and their guard triggers do not change.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.alterColumn('notification_outbox', 'recipient_account_id', { notNull: false });
  pgm.alterColumn('agent_profiles', 'account_id', { notNull: false });
  pgm.addColumn('agent_profiles', { deactivated_at: { type: 'timestamptz' } });
  // A re-run after a down finds erased rows that kept their NULL account and lost the column.
  pgm.sql(
    'UPDATE agent_profiles SET active = false, deactivated_at = now() WHERE account_id IS NULL',
  );
  pgm.addConstraint('agent_profiles', 'agent_profiles_pseudonymised_check', {
    check:
      '(account_id IS NOT NULL AND deactivated_at IS NULL) ' +
      'OR (account_id IS NULL AND deactivated_at IS NOT NULL AND NOT active)',
  });
};

/**
 * Restores each NOT NULL rule only while no erased row exists. An erased row keeps its NULL, so
 * the column stays nullable. The down never deletes rows.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('agent_profiles', 'agent_profiles_pseudonymised_check');
  pgm.dropColumn('agent_profiles', 'deactivated_at');
  for (const [table, column] of [
    ['agent_profiles', 'account_id'],
    ['notification_outbox', 'recipient_account_id'],
  ]) {
    pgm.sql(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} IS NULL) THEN
           ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;
         END IF;
       END $$`,
    );
  }
};
