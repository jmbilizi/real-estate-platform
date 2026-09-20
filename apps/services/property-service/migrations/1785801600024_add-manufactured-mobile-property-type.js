exports.shorthands = undefined;

/**
 * Adds `Manufactured/Mobile` to the closed `properties.property_type` vocabulary (#226).
 *
 * Bright's `StructureDesignType` carries `Manufactured` and `Mobile Pre 1976` with no target in the
 * 7-value vocabulary, so every manufactured/mobile home in the feed was withheld
 * (`unrecognized_property_type`, the third-largest rejection bucket, #216). Manufactured/mobile is a
 * standard RESO dwelling type, not an edge case, and a searchable segment on Zillow, Redfin and
 * Realtor.com.
 *
 * `'Other'` and a record blank on both `PropertySubType` and `StructureDesignType` stay rejected —
 * this migration adds one closed-vocabulary value, never a catch-all.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('properties', 'properties_property_type_check');
  pgm.addConstraint('properties', 'properties_property_type_check', {
    check:
      "property_type IN ('Single Family','Condo','Townhome','Multi-Family','Loft','Land'," +
      "'New Construction','Manufactured/Mobile')",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropConstraint('properties', 'properties_property_type_check');
  pgm.addConstraint('properties', 'properties_property_type_check', {
    check:
      "property_type IN ('Single Family','Condo','Townhome','Multi-Family','Loft','Land'," +
      "'New Construction')",
  });
};
