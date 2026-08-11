exports.shorthands = undefined;

/**
 * Read indexes for the Property API's three endpoints (#22).
 *
 * Deliberately only three, and each one serves an access pattern that did **not exist** before this
 * ticket. Full-text search over `title`/`address` and composite filter x sort tuning at 100k rows are
 * NOT here: that is #51, which owes EXPLAIN evidence first. Speculating now would buy write
 * amplification on every ingest for a plan nobody has measured, and would make #51's measurements
 * harder to read.
 *
 * Known and accepted as sequential scans until #51 measures them: the `zip` prefix match and the
 * free-text `query` substring match. Both are `starts_with`/`strpos` over the masked columns, which no
 * btree can serve — making them index-usable is an FTS-vs-trigram design decision, i.e. exactly the
 * choice #51 exists to make with data in hand rather than by guess here.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Serves the soonest-UPCOMING-occurrence LATERAL that migration 009 puts inside listing_search_v:
  // per listing, walk non-cancelled occurrences in start order and stop at the first one still
  // running or still to come. This is the one index here that is a correctness-of-shape concern
  // rather than a tuning concern — without it every row of every search re-scans this table, which
  // is an N+1 expressed in SQL rather than in application code. `ends_at` is the third column so the
  // `ends_at > now()` bound is an index condition instead of a heap recheck.
  pgm.createIndex('listing_open_houses', ['listing_id', 'starts_at', 'ends_at'], {
    where: 'NOT is_cancelled',
    name: 'idx_listing_open_houses_upcoming',
  });

  // The default sort of the default search — `recommended` is `featured DESC, last_updated DESC,
  // id DESC` — which makes this the single most-executed query the consumer product will have. A
  // sort-only index is not the "composite filter x sort" tuning #51 defers; it is the ordering the
  // API contract fixes and cannot change without a contract change.
  //
  // Partial on the same predicates as the existing idx_listings_live_price, for consistency with
  // that shape. This is an index restriction, NOT a second copy of the view's compliance rules: no
  // query written against it may restate these predicates (see listing_search_v).
  pgm.createIndex(
    'listings',
    [
      { name: 'featured', sort: 'DESC' },
      { name: 'last_updated', sort: 'DESC' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_recommended',
    },
  );

  // The neighborhood filter is case-insensitive EXACT equality — neighborhood is the card title and
  // a chip target, not a substring search — so the existing GIN trigram index (built for fuzzy
  // matching) is the wrong structure for it. `properties` already carries the equivalent expression
  // index; `listings` is what the view actually filters on, because the locality snapshot is what
  // keeps search a single-table query.
  pgm.createIndex('listings', 'lower(neighborhood)', {
    name: 'idx_listings_neighborhood_lower',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('listings', 'lower(neighborhood)', { name: 'idx_listings_neighborhood_lower' });
  pgm.dropIndex('listings', ['featured', 'last_updated', 'id'], {
    name: 'idx_listings_recommended',
  });
  pgm.dropIndex('listing_open_houses', ['listing_id', 'starts_at', 'ends_at'], {
    name: 'idx_listing_open_houses_upcoming',
  });
};
