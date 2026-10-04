exports.shorthands = undefined;

/**
 * #564. Detail-page facts from the Bright record: tax, HOA, virtual tour, listing-agent contact
 * and eight grouped facts.
 *
 * The scalar facts are nullable columns on `listings`, like `listing_agent_name`. No view changes:
 * only the detail query reads them, joined to `listings` by id beside `listing_search_v`.
 *
 * The grouped facts are rows in `listing_facts`, not an array column. The group is a closed set of
 * eight physical features. The value is a short token that Bright takes from a lookup. An unknown
 * group or a value that is too long fails the CHECK. There is no tag or keyword group, so Fair
 * Housing steering text has no group to land in.
 *
 * No backfill: a row fills the next time the sync writes it. See the property-service AGENTS.md
 * for the command that forces a full backfill.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE listings
      ADD COLUMN tax_annual_amount  numeric(14, 2),
      ADD COLUMN tax_year           smallint,
      ADD COLUMN hoa_fee            numeric(14, 2),
      ADD COLUMN hoa_fee_frequency  text,
      ADD COLUMN virtual_tour_url   text,
      ADD COLUMN list_agent_phone   text,
      ADD COLUMN list_agent_email   text,
      ADD CONSTRAINT listings_tax_annual_amount_nonneg
        CHECK (tax_annual_amount IS NULL OR tax_annual_amount >= 0),
      ADD CONSTRAINT listings_hoa_fee_nonneg CHECK (hoa_fee IS NULL OR hoa_fee >= 0)
  `);

  pgm.sql(`
    CREATE TABLE listing_facts (
      listing_id  uuid     NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
      fact_group  text     NOT NULL,
      position    smallint NOT NULL,
      value       text     NOT NULL,
      PRIMARY KEY (listing_id, fact_group, position),
      CONSTRAINT listing_facts_group_check CHECK (fact_group IN
        ('parking', 'heating', 'cooling', 'appliances', 'basement', 'flooring', 'interior',
         'exterior')),
      CONSTRAINT listing_facts_value_check CHECK (char_length(value) BETWEEN 1 AND 80)
    )
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS listing_facts');
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_tax_annual_amount_nonneg,
      DROP CONSTRAINT IF EXISTS listings_hoa_fee_nonneg,
      DROP COLUMN IF EXISTS tax_annual_amount,
      DROP COLUMN IF EXISTS tax_year,
      DROP COLUMN IF EXISTS hoa_fee,
      DROP COLUMN IF EXISTS hoa_fee_frequency,
      DROP COLUMN IF EXISTS virtual_tour_url,
      DROP COLUMN IF EXISTS list_agent_phone,
      DROP COLUMN IF EXISTS list_agent_email
  `);
};
