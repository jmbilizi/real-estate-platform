exports.shorthands = undefined;

/**
 * Staged `BrightMedia` rows are looked up by the listing they belong to, both when the ingest job
 * replaces one listing's gallery and when the mapper writes `listing_media`. The primary key is
 * `(resource, record_key)` = `MediaKey`, which cannot serve that lookup, so this indexes the
 * payload's `ResourceRecordKey` (= the property's `ListingKey`) for the `BrightMedia` rows only.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex('bright_staging_records', "(payload->>'ResourceRecordKey')", {
    name: 'idx_bright_staging_media_listing',
    where: "resource = 'BrightMedia'",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('bright_staging_records', "(payload->>'ResourceRecordKey')", {
    name: 'idx_bright_staging_media_listing',
  });
};
