exports.shorthands = undefined;

/**
 * #722. Search groups listings by listing office. The key is Bright's `ListOfficeKey`, the identity
 * of the office. The name is not an identity: one office has several spellings, and two offices can
 * share a name.
 *
 * `office_key` is text, not bigint: it is an identity, never a number to add or compare. It is
 * nullable. Rows written before this migration carry no key until the next feed sync writes them.
 * A row with no key joins the "Other / unlisted" group. The index is in migration 057, because
 * `CREATE INDEX CONCURRENTLY` cannot run in this migration's transaction.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumn('listings', { office_key: { type: 'text' } });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn('listings', 'office_key');
};
