exports.shorthands = undefined;

/**
 * Delivery state for `listing_inquiries` (#134). #131 recorded only `pending`.
 *
 * States: pending -> sending -> delivered | pending (retry) | failed (attempts exhausted).
 * `sample` marks an inquiry on a sample listing (#93). It is never sent to intake.
 *
 * `delivery_claimed_at` lets a worker reclaim a `sending` row whose process died mid-send.
 * `delivery_last_error` holds the provider error text only. It never holds consumer data.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('listing_inquiries', {
    delivery_attempts: { type: 'integer', notNull: true, default: 0 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    delivery_claimed_at: { type: 'timestamptz' },
    delivered_at: { type: 'timestamptz' },
    delivery_message_id: { type: 'text' },
    delivery_last_error: { type: 'text' },
  });

  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check');
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check', {
    check: "delivery_state IN ('pending', 'sending', 'delivered', 'failed', 'sample')",
  });

  // A delivered row must carry its provider id and time. Verifiable means recorded.
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_delivered_evidence', {
    check:
      "delivery_state <> 'delivered' OR (delivered_at IS NOT NULL AND delivery_message_id IS NOT NULL)",
  });

  // The worker scans only rows that still need work.
  pgm.createIndex('listing_inquiries', 'next_attempt_at', {
    name: 'idx_listing_inquiries_undelivered',
    where: "delivery_state IN ('pending', 'sending')",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('listing_inquiries', 'next_attempt_at', {
    name: 'idx_listing_inquiries_undelivered',
  });
  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_delivered_evidence');
  pgm.sql(
    "UPDATE listing_inquiries SET delivery_state = 'pending' " +
      "WHERE delivery_state IN ('sending', 'failed', 'sample', 'delivered')",
  );
  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check');
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check', {
    check: "delivery_state IN ('pending', 'delivered', 'failed')",
  });
  pgm.dropColumns('listing_inquiries', [
    'delivery_attempts',
    'next_attempt_at',
    'delivery_claimed_at',
    'delivered_at',
    'delivery_message_id',
    'delivery_last_error',
  ]);
};
