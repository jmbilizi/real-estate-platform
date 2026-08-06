exports.shorthands = undefined;

/**
 * `listing_events`: append-only listing history — the source of price history and days-on-market.
 *
 * `property_id` is denormalised deliberately so the property-level timeline ("what has this home done
 * over the years?") is one indexed query rather than a join through every listing. That is the
 * consumer-visible property-history strip incumbents have and we do not.
 *
 * Append-only: rows are never updated or deleted, so this is also the audit trail for an approved
 * correction to a closed listing (see `applyTerminalCorrection()` in src/db).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('listing_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: 'listings',
      onDelete: 'RESTRICT',
    },
    property_id: {
      type: 'uuid',
      notNull: true,
      references: 'properties',
      onDelete: 'RESTRICT',
    },
    event_type: {
      type: 'text',
      notNull: true,
      check:
        "event_type IN ('listed','price_change','status_change','relisted','withdrawn'," +
        "'expired','under_contract','closed','correction')",
    },
    // When the change happened upstream. Distinct from created_at, which is when we recorded it — a
    // feed can deliver a change hours later, and days-on-market must use the upstream instant.
    occurred_at: { type: 'timestamptz', notNull: true },
    old_price: { type: 'numeric(14,2)' },
    new_price: { type: 'numeric(14,2)' },
    old_status: { type: 'text' },
    new_status: { type: 'text' },
    // Free-form only for operator-authored corrections; never consumer-visible copy.
    note: { type: 'text' },
    is_sample: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('listing_events', ['listing_id', 'occurred_at'], {
    name: 'idx_listing_events_listing_occurred',
  });
  pgm.createIndex('listing_events', ['property_id', 'occurred_at'], {
    name: 'idx_listing_events_property_occurred',
  });
  pgm.createIndex('listing_events', ['listing_id', 'occurred_at'], {
    where: "event_type = 'price_change'",
    name: 'idx_listing_events_price_changes',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('listing_events');
};
