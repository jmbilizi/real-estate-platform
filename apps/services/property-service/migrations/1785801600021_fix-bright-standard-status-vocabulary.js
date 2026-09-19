/**
 * Corrects `listing_statuses.reso_standard_status` to Bright's real wire values (#93).
 *
 * Migration 003 seeded `reso_standard_status` as the space-separated display label
 * ('Active Under Contract', 'Coming Soon'). Verified against the live Bright test feed
 * 2026-09-19: Bright's `StandardStatus` is the RESO Data Dictionary lookup value, concatenated
 * PascalCase with no spaces — observed values are `Active`, `Pending`, `ActiveUnderContract`,
 * `Closed`, `ComingSoon`. The two multi-word codes never matched, so every Active-Under-Contract
 * and Coming-Soon record failed closed as an "unrecognised status" (#93's own fail-closed rule
 * working correctly on a wrong vocabulary). `code`/`label` are consumer-facing and unaffected.
 */

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE listing_statuses SET reso_standard_status = 'ActiveUnderContract'
     WHERE code = 'Active Under Contract'
  `);
  pgm.sql(`
    UPDATE listing_statuses SET reso_standard_status = 'ComingSoon'
     WHERE code = 'Coming Soon'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE listing_statuses SET reso_standard_status = 'Active Under Contract'
     WHERE code = 'Active Under Contract'
  `);
  pgm.sql(`
    UPDATE listing_statuses SET reso_standard_status = 'Coming Soon'
     WHERE code = 'Coming Soon'
  `);
};
