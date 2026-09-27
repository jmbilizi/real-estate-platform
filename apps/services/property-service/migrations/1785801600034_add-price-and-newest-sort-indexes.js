exports.shorthands = undefined;

/**
 * #368/#51: EXPLAIN ANALYZE against the search window raised by #368 showed two sorts with no
 * index path, both far past the ~300 ms budget at deep offset: `price-asc`/`price-desc` (a full
 * seq scan + sort — 700 ms at page 1, before any paging depth is involved) and `newest` (an
 * `Index Scan Backward` on `idx_listings_last_updated` that still needs an `Incremental Sort` for
 * the `id` tiebreaker, because that index carries only `last_updated` — 1.5 s at the new deepest
 * offset). Both get the same shape as `idx_listings_recommended` (migration 008): a partial index
 * over the sort columns PLUS the `id` tiebreaker, restricted to the same
 * `deleted_at IS NULL AND internet_display_allowed` predicate every search query already applies.
 *
 * `price` is an expression, not a plain column: `listing_search_v`'s `price` is
 * `CASE WHEN price_display_allowed THEN list_price END` (migration 020, seller price suppression,
 * #53), and a plain `list_price` index cannot serve an `ORDER BY` on that expression. The index
 * below repeats the expression verbatim so Postgres can match it syntactically — restating it here
 * is an index restriction on the view's existing rule, never a second copy of the rule itself (same
 * reasoning `idx_listings_recommended` documents).
 *
 * `price-asc`'s `NULLS LAST` is Postgres' default for `ASC` and is left implicit; `price-desc`
 * needs it stated, because the SQL default for `DESC` is `NULLS FIRST` and `search-query.ts`
 * requires `NULLS LAST` on both directions (a suppressed-price row sorts after every priced row,
 * never before).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex(
    'listings',
    [
      { name: 'CASE WHEN price_display_allowed THEN list_price END', sort: 'ASC' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_price_asc',
    },
  );

  pgm.createIndex(
    'listings',
    [
      { name: 'CASE WHEN price_display_allowed THEN list_price END', sort: 'DESC NULLS LAST' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_price_desc',
    },
  );

  pgm.createIndex(
    'listings',
    [
      { name: 'last_updated', sort: 'DESC' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_newest',
    },
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('listings', ['last_updated', 'id'], { name: 'idx_listings_newest' });
  pgm.dropIndex('listings', ['CASE WHEN price_display_allowed THEN list_price END', 'id'], {
    name: 'idx_listings_price_desc',
  });
  pgm.dropIndex('listings', ['CASE WHEN price_display_allowed THEN list_price END', 'id'], {
    name: 'idx_listings_price_asc',
  });
};
