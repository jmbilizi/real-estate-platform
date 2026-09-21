exports.shorthands = undefined;

/**
 * `listing_inquiries`: a consumer's message or tour request against a listing (#131).
 *
 * `listing_id` references `listings` with `ON DELETE RESTRICT`, matching `listing_events` — an
 * inquiry is a durable record of consumer intent and must not silently vanish because a listing
 * row was removed.
 *
 * `account_id` has no foreign key. It is resolved from account-service's introspection endpoint
 * (#86), a different database in a different service, so there is no local table to reference —
 * NULL means "was not signed in", never "unknown".
 *
 * The consent triad (`consent_to_contact`, `consent_disclosure_text`, `consent_given_at`) is kept
 * consistent by a CHECK, not by writer discipline: the stakeholder ruling (2026-09-13) requires
 * consent to be either fully recorded (the boolean, the exact disclosure text, and the timestamp
 * all present) or fully absent — never a bare `true` with no evidence of what was disclosed or
 * when.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('listing_inquiries', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: 'listings',
      onDelete: 'RESTRICT',
    },
    kind: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true },
    phone: { type: 'text' },
    message: { type: 'text' },
    // Resolved via account-service's credential introspection (#86). No FK — accounts live in a
    // different service's database.
    account_id: { type: 'uuid' },
    consent_to_contact: { type: 'boolean', notNull: true, default: false },
    consent_disclosure_text: { type: 'text' },
    consent_given_at: { type: 'timestamptz' },
    // Only 'pending' is ever written today — no delivery in this ticket. The column exists so an
    // undelivered inquiry is visible rather than indistinguishable from a delivered one.
    delivery_state: { type: 'text', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('listing_inquiries', 'listing_inquiries_kind_check', {
    check: "kind IN ('message', 'tour_request')",
  });

  pgm.addConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check', {
    check: "delivery_state IN ('pending', 'delivered', 'failed')",
  });

  // A 'message' inquiry without a message is the CTA producing no content at all — reject it in
  // the schema, not just at the API boundary. Non-empty is enforced by the Zod schema; this is
  // the structural backstop.
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_message_required_for_message_kind', {
    check: "kind <> 'message' OR message IS NOT NULL",
  });

  pgm.addConstraint('listing_inquiries', 'listing_inquiries_consent_triad', {
    check:
      '(consent_to_contact AND consent_disclosure_text IS NOT NULL AND consent_given_at IS NOT NULL) ' +
      'OR (NOT consent_to_contact AND consent_disclosure_text IS NULL AND consent_given_at IS NULL)',
  });

  pgm.createIndex('listing_inquiries', 'listing_id', {
    name: 'idx_listing_inquiries_listing_id',
  });

  pgm.createTrigger('listing_inquiries', 'listing_inquiries_set_updated_at', {
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
  pgm.dropTable('listing_inquiries');
};
