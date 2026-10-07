exports.shorthands = undefined;

const END_REASONS = ['unassigned', 'returned', 'closed', 'declined'];
const DECLINE_REASONS = [
  'no_capacity',
  'outside_service_area',
  'conflict_of_interest',
  'listing_unavailable',
  'other',
];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

/**
 * Agent "My leads" (#636).
 *
 * - `accepted_at`: when the agent accepted. Speed-to-lead reads it.
 * - `decline_reason`: the fixed-list reason of a decline. Set with `end_reason = 'declined'`.
 * - `end_reason` gains `declined`.
 *
 * The guard trigger of 049 lets an open row change any column outside its identity list, so
 * `accepted_at` and `decline_reason` need no trigger change.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('lead_assignments', {
    accepted_at: { type: 'timestamptz' },
    decline_reason: { type: 'text' },
  });
  pgm.dropConstraint('lead_assignments', 'lead_assignments_end_check');
  pgm.addConstraint('lead_assignments', 'lead_assignments_end_check', {
    check: `(ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IN (${list(END_REASONS)}))`,
  });
  pgm.addConstraint('lead_assignments', 'lead_assignments_decline_reason_check', {
    check: `decline_reason IS NULL OR decline_reason IN (${list(DECLINE_REASONS)})`,
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('lead_assignments', 'lead_assignments_decline_reason_check');
  pgm.dropConstraint('lead_assignments', 'lead_assignments_end_check');
  // The guard trigger refuses an UPDATE of an ended row, so disable it for the one remap.
  pgm.sql('ALTER TABLE lead_assignments DISABLE TRIGGER lead_assignments_guard');
  pgm.sql("UPDATE lead_assignments SET end_reason = 'returned' WHERE end_reason = 'declined'");
  pgm.sql('ALTER TABLE lead_assignments ENABLE TRIGGER lead_assignments_guard');
  pgm.addConstraint('lead_assignments', 'lead_assignments_end_check', {
    check:
      "(ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IN ('unassigned', 'returned', 'closed'))",
  });
  pgm.dropColumns('lead_assignments', ['accepted_at', 'decline_reason']);
};
