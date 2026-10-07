exports.shorthands = undefined;

const STATUSES = [
  'new',
  'verified',
  'assigned',
  'accepted',
  'contacted',
  'touring',
  'under_contract',
  'closed',
  'lost',
  'spam',
  'rejected',
];
const CHANNELS = ['email', 'phone_call', 'phone_text'];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

/**
 * Lead model on `listing_inquiries` (#627). The table keeps its name. A row is a buyer request.
 *
 * - `status`: lifecycle. The allowed transitions live in `src/inquiries/lead-status.ts`.
 * - `lead_status_events`: append-only audit trail of every status change.
 * - Contact rule: `email` stays required and `phone` stays optional (ruling 2026-10-06).
 * - `verified_account`: set by the server only.
 * - Consent evidence: `consent_text_version` and `consent_channels` join the existing triad.
 *   The text itself stays in `consent_disclosure_text`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('listing_inquiries', {
    status: { type: 'text', notNull: true, default: 'new' },
    verified_account: { type: 'boolean', notNull: true, default: false },
    consent_text_version: { type: 'text' },
    consent_channels: { type: 'text[]' },
  });

  pgm.addConstraint('listing_inquiries', 'listing_inquiries_status_check', {
    check: `status IN (${list(STATUSES)})`,
  });

  // Rows that recorded consent used the only text that existed. A row with no phone never named
  // a phone, so it gets the email channel only.
  pgm.sql(
    `UPDATE listing_inquiries
        SET consent_text_version = 'v1',
            consent_channels = CASE WHEN phone IS NULL
              THEN ARRAY['email']
              ELSE ARRAY[${list(CHANNELS)}] END
      WHERE consent_to_contact`,
  );
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_consent_evidence', {
    check:
      '(consent_to_contact AND consent_text_version IS NOT NULL ' +
      'AND consent_channels IS NOT NULL AND cardinality(consent_channels) > 0 ' +
      `AND consent_channels <@ ARRAY[${list(CHANNELS)}]) ` +
      'OR (NOT consent_to_contact AND consent_text_version IS NULL AND consent_channels IS NULL)',
  });

  pgm.createIndex('listing_inquiries', ['status', 'created_at'], {
    name: 'idx_listing_inquiries_status_created',
  });

  pgm.createTable('lead_status_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: 'listing_inquiries',
      onDelete: 'CASCADE',
    },
    // NULL on the creation event.
    from_status: { type: 'text' },
    to_status: { type: 'text', notNull: true },
    // NULL actor = the system. The role comes from the roles model (#628), so it is free text.
    actor_account_id: { type: 'uuid' },
    actor_role: { type: 'text', notNull: true },
    note: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('lead_status_events', 'lead_status_events_status_check', {
    check: `to_status IN (${list(STATUSES)}) AND (from_status IS NULL OR from_status IN (${list(STATUSES)}))`,
  });
  pgm.createIndex('lead_status_events', ['lead_id', 'created_at'], {
    name: 'idx_lead_status_events_lead',
  });

  // One creation event per existing row, so every lead has a complete history.
  pgm.sql(
    `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role, created_at)
     SELECT id, NULL, 'new', 'system', created_at FROM listing_inquiries`,
  );

  // Append-only. An UPDATE, a TRUNCATE or a direct DELETE fails. A DELETE is allowed only when
  // the parent lead is already gone (the FK cascade, for example a future retention purge).
  pgm.createFunction(
    'lead_status_events_append_only',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       IF TG_OP = 'DELETE' THEN
         IF NOT EXISTS (SELECT 1 FROM listing_inquiries WHERE id = OLD.lead_id) THEN
           RETURN OLD;
         END IF;
       END IF;
       RAISE EXCEPTION 'lead_status_events is append-only' USING ERRCODE = 'integrity_constraint_violation';
     END;`,
  );
  pgm.createTrigger('lead_status_events', 'lead_status_events_append_only', {
    when: 'BEFORE',
    operation: ['UPDATE', 'DELETE'],
    level: 'ROW',
    function: 'lead_status_events_append_only',
  });
  pgm.createTrigger('lead_status_events', 'lead_status_events_no_truncate', {
    when: 'BEFORE',
    operation: 'TRUNCATE',
    level: 'STATEMENT',
    function: 'lead_status_events_append_only',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('lead_status_events');
  pgm.dropFunction('lead_status_events_append_only', []);
  pgm.dropIndex('listing_inquiries', ['status', 'created_at'], {
    name: 'idx_listing_inquiries_status_created',
  });
  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_consent_evidence');
  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_status_check');
  pgm.dropColumns('listing_inquiries', [
    'status',
    'verified_account',
    'consent_text_version',
    'consent_channels',
  ]);
};
