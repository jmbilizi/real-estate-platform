exports.shorthands = undefined;

/**
 * #717. From now on `upsertListing` appends a `price_change` row to `listing_events` when a key's
 * `list_price` changes. Before this, every write appended a `listed` row that carried the price of
 * that write, so the earlier prices of a key are still in the table. This migration reads them once
 * and appends one `price_change` row where a `listed` row differs from the one before it.
 *
 * The rows keep the instant of the `listed` row that first showed the new price. The migration adds
 * no price. It restates prices the sync stored.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO listing_events
      (listing_id, property_id, event_type, occurred_at, old_price, new_price, is_sample)
    SELECT s.listing_id, s.property_id, 'price_change', s.occurred_at, s.previous_price, s.new_price,
           s.is_sample
    FROM (
      SELECT e.listing_id, e.property_id, e.occurred_at, e.new_price, e.is_sample,
             lag(e.new_price) OVER (
               PARTITION BY e.listing_id ORDER BY e.occurred_at, e.created_at, e.id
             ) AS previous_price
      FROM listing_events e
      WHERE e.event_type = 'listed' AND e.new_price IS NOT NULL
    ) s
    WHERE s.previous_price IS NOT NULL AND s.previous_price <> s.new_price
      -- The write path stores the same row with the same instant. Never add it twice.
      AND NOT EXISTS (
        SELECT 1 FROM listing_events x
        WHERE x.listing_id = s.listing_id AND x.event_type = 'price_change'
          AND x.occurred_at = s.occurred_at AND x.new_price = s.new_price
      )
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
  // The rows are append-only history. The rows stay.
};
