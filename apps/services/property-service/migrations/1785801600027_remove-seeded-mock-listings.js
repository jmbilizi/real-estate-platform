exports.shorthands = undefined;

/**
 * Removes the seeded mock inventory from every environment that holds it (stakeholder request
 * 2026-09-23). Real Bright MLS data now fills search, so the mock listings only get in the way.
 *
 * A migration rather than a script because the `migrate` initContainer runs it in every
 * environment on its next deploy, once, with nothing for anyone to remember. The seeder is switched
 * off in the same change (the `PROPERTY_SERVICE_SEED_ON_START` overlays), so nothing re-inserts them.
 *
 * Scope: the SEEDED rows only — `source = 'internal' AND is_sample = true`. A Bright test-feed row is
 * also `is_sample`, but it is real feed data and stays. Order follows the foreign keys, the same
 * order as `SAMPLE_DATA_DELETE_STATEMENTS` in `src/db/write.ts`. Inquiries against a mock listing go
 * too: they were made on a fabricated home and have no agent to route to, and `listing_inquiries`
 * is ON DELETE RESTRICT. Durable rows (units, properties, communities) are deleted only when no
 * remaining row references them.
 *
 * Irreversible by nature: `down` does nothing. Re-seeding is `pnpm exec nx run property-service:seed`.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TEMP TABLE mock_listings ON COMMIT DROP AS
      SELECT id FROM listings WHERE source = 'internal' AND is_sample = true;

    DELETE FROM listing_inquiries WHERE listing_id IN (SELECT id FROM mock_listings);
    DELETE FROM listing_attributes WHERE listing_id IN (SELECT id FROM mock_listings);
    DELETE FROM listing_events WHERE listing_id IN (SELECT id FROM mock_listings);
    DELETE FROM listing_media WHERE listing_id IN (SELECT id FROM mock_listings);
    DELETE FROM listing_open_houses WHERE listing_id IN (SELECT id FROM mock_listings);
    DELETE FROM listings WHERE id IN (SELECT id FROM mock_listings);

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

    DELETE FROM seed_state;
  `);
};

exports.down = () => {};
