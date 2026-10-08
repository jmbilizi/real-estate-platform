exports.shorthands = undefined;

/**
 * #716. Search shows one card per home. `src/listings/collapse.ts` builds the query. This migration
 * gives it two pieces.
 *
 * 1. `idx_listings_live_property`. For each candidate card, the collapse probes `listings` for a live
 *    record of the same property. The partial index answers that probe from the index alone. It holds
 *    only the live statuses the collapse reads, so it stays small. The status list repeats
 *    `LIVE_STATUSES` in `collapse.ts`. `collapse.spec.ts` asserts both match.
 *
 * 2. `property_is_parcel(uuid)`. A lot or a parcel is never merged: two parcels can share one
 *    address. The test reads the street line. Application SQL must never name `street_line` (#48), so
 *    the test lives here and returns one boolean. It is true for the Land type, a street with no
 *    number, a street number of 0 or 00, and a street line with the word "Lot" or "Parcel". An
 *    unknown property is not a parcel, but the caller treats a NULL answer as one.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex('listings', ['property_id', 'id'], {
    name: 'idx_listings_live_property',
    where:
      "deleted_at IS NULL AND internet_display_allowed AND consumer_status IN ('Active', 'Coming Soon', 'Pending')",
  });

  pgm.sql(`
    CREATE FUNCTION property_is_parcel(property_uuid uuid) RETURNS boolean
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
      SELECT p.property_type = 'Land'
          OR p.street_line !~ '^[0-9]'
          OR p.street_line ~ '^0{1,2}[[:space:]]'
          OR p.street_line ~* '\\m(lot|parcel)\\M'
      FROM properties p
      WHERE p.id = property_uuid
    $$
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION IF EXISTS property_is_parcel(uuid)');
  pgm.dropIndex('listings', ['property_id', 'id'], { name: 'idx_listings_live_property' });
};
