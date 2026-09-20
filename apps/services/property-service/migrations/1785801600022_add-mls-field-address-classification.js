exports.shorthands = undefined;

/**
 * Default-deny address classification for MLS attribute fields (#128).
 *
 * THE RULE. `mls_fields.address_classification` is a closed vocabulary: `carries_address` (the
 * address itself), `re_identifies_address` (coordinates, a parcel number/APN, a ZIP+4, a
 * subdivision plus lot/block — anything that maps back to one parcel without naming it),
 * `free_text_may_contain_address` (remarks, directions, showing instructions, a media caption —
 * feed-authored prose that routinely embeds a street line), or `not_address_bearing`. A field may
 * also carry NO classification: NULL, meaning nobody has reviewed it yet.
 *
 * `suppression.ts` treats every value except `not_address_bearing`, NULL included, as
 * address-bearing and withholds it on a suppressed listing. No column value and no code path means
 * "unclassified, therefore publish" — the failure this ticket exists to close (#48, #59, #105 each
 * shipped that exact gap once).
 *
 * WHY THE DEFAULT IS DENY. #127 already shipped `is_address_bearing`, a boolean default-TRUE, so
 * the coarse default-deny existed before this migration. What was missing is a vocabulary wide
 * enough to say WHY a field is withheld: a raw address line, a re-identifying fact and free text
 * that may embed one are three different risks with the same outcome, and naming them is what lets
 * a reviewer classify a field with confidence instead of guessing at a bare boolean. The two axes
 * are tied by a CHECK below so they cannot disagree — `is_address_bearing` stays the one column
 * every other query in this service already reasons about, and `address_classification` is what a
 * human reviewing the registry reads.
 *
 * WHAT IS NOT SUPPRESSED. A field classified `not_address_bearing` publishes on a suppressed
 * listing exactly as it would on any other — price, condition, amenities and every other
 * non-address fact are unaffected by this migration.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.addColumns('mls_fields', {
    address_classification: { type: 'text' },
  });

  pgm.addConstraint('mls_fields', 'mls_fields_address_classification_vocabulary', {
    check:
      'address_classification IS NULL OR address_classification IN ' +
      "('carries_address', 're_identifies_address', 'free_text_may_contain_address', 'not_address_bearing')",
  });

  // Ties the closed vocabulary to the boolean #127 already enforces, so the two axes can never
  // disagree. IS DISTINCT FROM treats NULL as not equal to 'not_address_bearing', which is what
  // makes an unclassified field land on the address-bearing (TRUE) side.
  pgm.addConstraint('mls_fields', 'mls_fields_classification_matches_bearing', {
    check: "is_address_bearing = (address_classification IS DISTINCT FROM 'not_address_bearing')",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('mls_fields', 'mls_fields_classification_matches_bearing');
  pgm.dropConstraint('mls_fields', 'mls_fields_address_classification_vocabulary');
  pgm.dropColumns('mls_fields', ['address_classification']);
};
