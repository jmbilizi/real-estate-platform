exports.shorthands = undefined;

/**
 * #344. NAR Policy 7.58 requires the listing firm plus "the email or phone number provided by the
 * listing participant" — one of the two, not both. 45% of the Bright feed carries an office name
 * and phone but no office email; the `NOT NULL` on `broker_email` forced the mapper to withhold
 * every one of those listings. `broker_phone` stays `NOT NULL`: the mapper writes `''` for the
 * rare row with an email but no phone (#344, `bright-map/attribution.ts`).
 *
 * `listing_search_v` selects `l.broker_email` unchanged; a column's nullability needs no view
 * change.
 */

exports.up = (pgm) => {
  pgm.alterColumn('listings', 'broker_email', { notNull: false });
};

exports.down = (pgm) => {
  pgm.alterColumn('listings', 'broker_email', { notNull: true });
};
