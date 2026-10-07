exports.shorthands = undefined;

/**
 * Inquiries require an account (#690).
 *
 * Deletes every anonymous lead (`listing_inquiries.account_id IS NULL`), then sets `account_id`
 * NOT NULL.
 *
 * THE DELETION IS SAFE ONLY BECAUSE NO REAL USERS EXIST (stakeholder fact 2026-10-07). Every
 * anonymous lead is dev test data. Do not copy this pattern once real leads exist.
 *
 * Every table that points at a lead (`lead_status_events`, `lead_notes`, `lead_access_audit`,
 * `lead_assignments`, `notification_outbox`) has `ON DELETE CASCADE`. The append-only guard
 * triggers let a delete pass once the parent lead is gone, so one DELETE of the parent removes the
 * dependent rows in foreign-key order. No guard trigger is disabled.
 *
 * The down migration restores nullability only. It restores no data.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql('DELETE FROM listing_inquiries WHERE account_id IS NULL');
  pgm.alterColumn('listing_inquiries', 'account_id', { notNull: true });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.alterColumn('listing_inquiries', 'account_id', { notNull: false });
};
