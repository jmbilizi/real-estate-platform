exports.shorthands = undefined;

/**
 * #349. Every held listing has a property page in its current market status.
 *
 * 1. `Off Market` status. The sync sets it on a listing that Bright no longer returns, or whose
 *    record no longer maps, instead of a soft delete. It has no `consumer_status`, so search
 *    (`listing_search_v`) excludes it. It is not terminal, so a record that maps again re-snapshots.
 *    It has no `reso_standard_status`, so no feed value maps to it.
 *
 * 2. `listing_detail_v`, the property page read model. One row per live listing, in any status.
 *    `listing_data_displayable` is true exactly when `listing_search_v` holds the row, so every
 *    listing-data rule stays in that one view. Off market rows (withdrawn, expired, canceled, hold,
 *    a sold outside the display rule, `Off Market`) project only the address and the property
 *    record: NAR 7.58 forbids the display of their listing data. The address stays masked on
 *    `address_display_allowed`, and `internet_display_allowed = false` still hides the whole row.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO listing_statuses
      (code, label, consumer_status, is_publicly_searchable, counts_toward_dom, is_terminal,
       reso_standard_status, sort_order)
    VALUES ('Off Market', 'Off market', NULL, false, false, false, NULL, 11)
    ON CONFLICT (code) DO NOTHING
  `);

  pgm.sql(`
    CREATE VIEW listing_detail_v AS
    SELECT
      l.id,
      l.property_id,
      l.unit_id,
      (v.id IS NOT NULL)                                    AS listing_data_displayable,
      CASE
        WHEN v.id IS NULL THEN 'Off market'
        WHEN l.status = 'Active Under Contract' THEN 'Under Contract'
        WHEN l.status = 'Closed' THEN 'Sold'
        ELSE l.consumer_status
      END                                                   AS market_status,
      CASE WHEN l.address_display_allowed THEN p.street_line END AS address_street,
      CASE WHEN l.address_display_allowed THEN u.unit_number END AS unit_number,
      l.city,
      l.state,
      l.zip5                                                AS zip,
      p.property_type,
      COALESCE(u.beds, p.beds)                              AS beds,
      COALESCE(u.baths_display, p.baths_display)            AS baths,
      COALESCE(u.living_sqft, p.living_sqft)                AS sqft,
      p.lot_sqft,
      p.year_built,
      l.source,
      (l.is_sample OR p.is_sample OR COALESCE(u.is_sample, false)) AS is_sample,
      l.last_updated
    FROM listings l
    JOIN properties p ON p.id = l.property_id
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN listing_search_v v ON v.id = l.id
    WHERE l.deleted_at IS NULL
      AND l.internet_display_allowed
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS listing_detail_v');
  // The status row cannot go while a listing references it, so the rows are soft-deleted first.
  pgm.sql(`
    UPDATE listings SET deleted_at = COALESCE(deleted_at, now()), status = 'Withdrawn'
     WHERE status = 'Off Market';
    DELETE FROM listing_statuses WHERE code = 'Off Market';
  `);
};
