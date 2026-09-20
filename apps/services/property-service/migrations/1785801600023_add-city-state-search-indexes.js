exports.shorthands = undefined;

/**
 * #81: `city`/`state` search filters are case-insensitive EXACT equality, the same predicate shape
 * as `neighborhood` (migration 008). The existing `idx_listings_city_state_zip` btree
 * (migration 003) cannot serve `lower(city)`/`lower(state)` — a plain btree does not match an
 * expression predicate. Indexed immediately, matching migration 008's precedent for this exact
 * shape, rather than deferred to #51: #51 defers composite filter x sort tuning and substring
 * matches with no btree-servable shape (`zip` prefix, free-text `query`), not a shape this
 * codebase already established should be indexed on introduction.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex('listings', 'lower(city)', { name: 'idx_listings_city_lower' });
  pgm.createIndex('listings', 'lower(state)', { name: 'idx_listings_state_lower' });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('listings', 'lower(state)', { name: 'idx_listings_state_lower' });
  pgm.dropIndex('listings', 'lower(city)', { name: 'idx_listings_city_lower' });
};
