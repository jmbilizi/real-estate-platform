exports.shorthands = undefined;

/**
 * #377. `GET /listings/map` filters on the view's masked `latitude`/`longitude`
 * (`CASE WHEN address_display_allowed THEN latitude END`). `idx_properties_geog` cannot serve that
 * predicate: the masked `geog` joins two tables. This index repeats the view's expressions
 * verbatim so Postgres matches them, the same way `idx_listings_price_asc` (migration 034) does.
 * A row with a withheld address has NULL here, so the index cannot place it either.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex(
    'listings',
    [
      { name: 'CASE WHEN address_display_allowed THEN latitude END' },
      { name: 'CASE WHEN address_display_allowed THEN longitude END' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_map_coords',
    },
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex(
    'listings',
    [
      'CASE WHEN address_display_allowed THEN latitude END',
      'CASE WHEN address_display_allowed THEN longitude END',
    ],
    { name: 'idx_listings_map_coords' },
  );
};
