exports.shorthands = undefined;

const EVENTS = ['lead.received', 'lead.verified', 'lead.assigned', 'lead.accepted'];
const STATES = ['held', 'queued', 'sent', 'failed', 'cancelled'];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

/**
 * Notification outbox (#638). Records what a later sender would send. No sender exists.
 *
 * - Every row starts `held`. No code in this service moves a row past `held`.
 * - `recipient_ref` is an id, never a copied email or phone. `recipient_ref_type` says which id.
 * - `payload` holds ids only.
 *
 * Also drops the dormant #134 delivery columns of `listing_inquiries`. Nothing reads them.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('notification_outbox', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: 'listing_inquiries',
      onDelete: 'CASCADE',
    },
    event_type: { type: 'text', notNull: true },
    recipient_kind: { type: 'text', notNull: true },
    channel: { type: 'text', notNull: true },
    recipient_ref: { type: 'uuid', notNull: true },
    recipient_ref_type: { type: 'text', notNull: true },
    template_key: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true, default: 'held' },
    payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_event_check', {
    check: `event_type IN (${list(EVENTS)})`,
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_kind_check', {
    check: "recipient_kind IN ('buyer', 'agent')",
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_channel_check', {
    check: "channel IN ('email', 'sms')",
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_ref_type_check', {
    check:
      "(recipient_kind = 'agent' AND recipient_ref_type = 'agent_profile') " +
      "OR (recipient_kind = 'buyer' AND recipient_ref_type IN ('account', 'lead'))",
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_state_check', {
    check: `state IN (${list(STATES)})`,
  });
  pgm.addConstraint('notification_outbox', 'notification_outbox_payload_check', {
    check: "jsonb_typeof(payload) = 'object'",
  });
  pgm.createIndex('notification_outbox', 'created_at', {
    name: 'idx_notification_outbox_held',
    where: "state = 'held'",
  });
  pgm.createIndex('notification_outbox', ['lead_id', 'created_at'], {
    name: 'idx_notification_outbox_lead',
  });

  pgm.dropIndex('listing_inquiries', 'next_attempt_at', {
    name: 'idx_listing_inquiries_undelivered',
  });
  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_delivered_evidence');
  pgm.dropConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check');
  pgm.dropColumns('listing_inquiries', [
    'delivery_state',
    'delivery_attempts',
    'next_attempt_at',
    'delivery_claimed_at',
    'delivered_at',
    'delivery_message_id',
    'delivery_last_error',
  ]);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.addColumns('listing_inquiries', {
    delivery_state: { type: 'text', notNull: true, default: 'pending' },
    delivery_attempts: { type: 'integer', notNull: true, default: 0 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    delivery_claimed_at: { type: 'timestamptz' },
    delivered_at: { type: 'timestamptz' },
    delivery_message_id: { type: 'text' },
    delivery_last_error: { type: 'text' },
  });
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_delivery_state_check', {
    check: "delivery_state IN ('pending', 'sending', 'delivered', 'failed', 'sample')",
  });
  pgm.addConstraint('listing_inquiries', 'listing_inquiries_delivered_evidence', {
    check:
      "delivery_state <> 'delivered' OR (delivered_at IS NOT NULL AND delivery_message_id IS NOT NULL)",
  });
  pgm.createIndex('listing_inquiries', 'next_attempt_at', {
    name: 'idx_listing_inquiries_undelivered',
    where: "delivery_state IN ('pending', 'sending')",
  });
  pgm.dropTable('notification_outbox');
};
