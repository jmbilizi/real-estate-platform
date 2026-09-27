exports.shorthands = undefined;

/**
 * Removes every sample-marked row (stakeholder ruling 2026-09-26: no environment keeps sample or
 * Bright test-feed data). Migration 027 removed only the seeded mock rows and kept test-feed rows,
 * and the tier sweep in `bright-map/sweep.ts` ran only while other-tier staging rows existed, so dev
 * kept its test-feed listings after the switch to production.
 *
 * Same statement order as `SAMPLE_DATA_DELETE_STATEMENTS` in `src/db/write.ts`, plus inquiries and
 * attributes, because `listing_inquiries` is ON DELETE RESTRICT. Irreversible: `down` does nothing.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TEMP TABLE sample_listings ON COMMIT DROP AS
      SELECT id FROM listings WHERE is_sample = true;

    DELETE FROM listing_inquiries WHERE listing_id IN (SELECT id FROM sample_listings);
    DELETE FROM listing_attributes WHERE listing_id IN (SELECT id FROM sample_listings);
    DELETE FROM listing_events WHERE listing_id IN (SELECT id FROM sample_listings);
    DELETE FROM listing_media WHERE listing_id IN (SELECT id FROM sample_listings);
    DELETE FROM listing_open_houses WHERE listing_id IN (SELECT id FROM sample_listings);
    DELETE FROM listings WHERE id IN (SELECT id FROM sample_listings);

    DELETE FROM units u
     WHERE u.is_sample = true
       AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.unit_id = u.id);
    DELETE FROM property_attributes a
     USING properties p
     WHERE a.property_id = p.id
       AND p.is_sample = true
       AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.property_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM units u WHERE u.property_id = p.id);
    DELETE FROM properties p
     WHERE p.is_sample = true
       AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.property_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM units u WHERE u.property_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM listing_events e WHERE e.property_id = p.id);
    DELETE FROM communities c
     WHERE c.is_sample = true
       AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.community_id = c.id);

    DELETE FROM bright_staging_records WHERE feed_tier = 'test';
    DELETE FROM bright_replication_cursor WHERE feed_tier = 'test';
  `);
};

exports.down = () => {};
