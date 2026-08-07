exports.shorthands = undefined;

/**
 * `listing_media`: the image gallery as rows, replacing `listings.image_urls text[]`.
 *
 * A text[] has no ordering guarantee, no alt text (accessibility is a stated rule for the web app), no
 * per-asset provenance for IDX purge-on-expiry, and no link to the PRD §9 media pipeline. RESO models
 * media as its own resource for the same reasons.
 *
 * `media_id` is a deliberate cross-service reference with NO foreign key — media-service owns that
 * table in a different database. This follows the existing convention (account-service's
 * ApplicationUser.ProfileImageId). Binaries never live in property_db.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('listing_media', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: 'listings',
      onDelete: 'CASCADE',
    },
    // Owned by media-service; no FK across service databases. NULL while an asset is still only an
    // upstream URL we have not ingested.
    media_id: { type: 'uuid' },
    // The upstream (MLS) URL and its stable key, kept so an expired listing's media can be purged and
    // so re-ingest is idempotent.
    source_url: { type: 'text' },
    source_media_key: { type: 'text' },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    is_primary: { type: 'boolean', notNull: true, default: false },
    caption: { type: 'text' },
    // Accessibility requirement, and separately a Fair Housing surface: alt text is consumer-visible
    // copy, so if it is ever AI-generated it needs the same provenance treatment as a description.
    alt_text: { type: 'text' },
    is_sample: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('listing_media', ['listing_id', 'sort_order'], {
    name: 'idx_listing_media_listing_sort',
  });
  // At most one primary image per listing.
  pgm.createIndex('listing_media', 'listing_id', {
    unique: true,
    where: 'is_primary',
    name: 'idx_listing_media_one_primary',
  });
  pgm.createIndex('listing_media', ['listing_id', 'source_media_key'], {
    unique: true,
    where: 'source_media_key IS NOT NULL',
    name: 'idx_listing_media_source_key',
  });

  pgm.createTrigger('listing_media', 'listing_media_set_updated_at', {
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
  pgm.dropTable('listing_media');
};
