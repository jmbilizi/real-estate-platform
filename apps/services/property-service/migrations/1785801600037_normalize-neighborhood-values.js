exports.shorthands = undefined;

/**
 * #390. Applies the write-time neighborhood cleanup (`src/db/neighborhood-normalize.ts`) to every
 * row already stored, so the neighborhoods aggregate reads clean data from day one instead of
 * waiting on a full Bright re-sync. Same rules the mapper now applies to every new record: trim,
 * collapse internal whitespace, strip wrapping quotes and a trailing period run, then map a noise
 * value ("NONE AVAILABLE" and its misspellings, "N/A", "000", ...) to NULL.
 *
 * Two statements rather than one: the first cleans up formatting only, so a value that becomes
 * noise ONLY after cleanup ("NONE AVAILABLE.") is still caught by the second statement's noise
 * check, which runs against the already-cleaned value.
 *
 * Irreversible: the noise values collapsed to NULL are not recoverable, matching migration 035's
 * precedent for a lossy cleanup — `down` does nothing.
 *
 * The composite index serves `GET /listings/neighborhoods`'s
 * `GROUP BY lower(neighborhood), lower(city), state`. `CREATE INDEX CONCURRENTLY` plus
 * `pgm.noTransaction()` per this service's rule for any index migration on `listings`:
 * `bright-sync-worker` writes this table continuously, and a blocking index build would stall
 * ingest for as long as the migration runs.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.noTransaction();

  pgm.sql(`
    UPDATE listings
       SET neighborhood = NULLIF(
             regexp_replace(
               regexp_replace(trim(neighborhood), '\\s+', ' ', 'g'),
               '\\.+$', ''
             ),
             ''
           )
     WHERE neighborhood IS NOT NULL
  `);

  pgm.sql(`
    UPDATE listings
       SET neighborhood = trim(both '''"' from neighborhood)
     WHERE neighborhood IS NOT NULL
  `);

  pgm.sql(`
    UPDATE listings
       SET neighborhood = NULL
     WHERE neighborhood IS NOT NULL
       AND (
             trim(neighborhood) = ''
             OR neighborhood ~* '^NONE'
             OR neighborhood ~* '^N/?A$'
             OR neighborhood ~* '^UNKNOWN$'
             OR neighborhood ~* '^NOT ON (THE )?LIST$'
             OR neighborhood ~* '^NOT IN A? ?DEVELOPMENT$'
             OR neighborhood ~* '^NOT IN A? ?SUBDIVISION$'
             OR neighborhood ~ '^[0-9\\s.,_/-]*$'
           )
  `);

  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_neighborhood_group
      ON listings (lower(neighborhood), lower(city), state)
      WHERE deleted_at IS NULL AND internet_display_allowed AND neighborhood IS NOT NULL
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.noTransaction();
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_listings_neighborhood_group');
};
