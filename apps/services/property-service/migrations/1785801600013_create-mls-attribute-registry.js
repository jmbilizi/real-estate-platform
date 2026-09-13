exports.shorthands = undefined;

/**
 * The governed MLS attribute model: `mls_fields` + `mls_lookup_values` + `listing_attributes` +
 * `property_attributes` (#127).
 *
 * WHAT THIS DECIDES. A licensed MLS feed carries a couple hundred fields, give or take, with real
 * upside. That magnitude is the whole reason this file exists, and it settles one hard-to-reverse
 * question: a few dozen fields would say "typed columns", a few thousand would say "attribute store",
 * and a couple hundred with unknown upside says BOTH, split on a line that is easy to state —
 *
 *   The columns the product FILTERS AND SORTS on stay first-class relational columns on `listings`
 *   (price, beds, baths, living area, status, city/state/zip, geo). Everything else — the long tail
 *   this repo has never named — lands here.
 *
 * The line is not aesthetic. `idx_listings_live_price` is a partial composite btree over
 * `(consumer_status, list_price)`; no attribute-store join reproduces that, and #22's search is a
 * single-table indexed query precisely so it stays one. Conversely a CHECK constraint per vocabulary
 * does not scale past a handful, which is the failure this file removes.
 *
 * WHAT IT DOES NOT DO. `listings.amenities` and `properties.property_type` keep their CHECK
 * constraints and keep serving `searchRequestSchema` untouched; this store sits ALONGSIDE them.
 * Converging them later is a real option (an amenity is exactly a multi-valued lookup field) and is
 * deliberately left open in both directions — nothing here reads or writes those columns, and nothing
 * here depends on them staying as they are. Nothing in this migration is exposed to a consumer:
 * `listing_search_v` is not touched, and no field reaches the wire contract in this change.
 *
 * ── THE FAIR HOUSING GUARANTEE, WHICH IS THE REASON FOR THE SHAPE ──────────────────────────────────
 *
 * `listings`' closed sets are enforced in the DATABASE deliberately, so that an ingestion mapper or a
 * manual SQL fix cannot persist an unreviewable steering phrase, and there is deliberately no open
 * `keywords`/`tags`/`features` column. A naive attribute store is exactly that forbidden open bag with
 * extra steps: `attributes(listing_id, name, value text)` would accept "quiet safe block, great for
 * families" on day one.
 *
 * So THERE IS NO TEXT VALUE COLUMN ON THIS PATH, anywhere, and there must never be one. An attribute
 * value is either a reference to a registered lookup value or a typed scalar (numeric / boolean /
 * date / timestamp). Free text is not merely discouraged here, it is unrepresentable: there is no
 * column it could go in. Prose keeps the one route it has always had — `listings.description` behind
 * the `description_moderation` gate, unchanged by this migration.
 *
 * A consequence worth stating because it will look like an omission: a short IDENTIFIER-shaped feed
 * field (a parcel number, a subdivision name) is also not storable through this path. That is correct.
 * Identifiers that the product actually needs get reviewed columns, like `source_listing_id` did.
 *
 * ── AND THE ADDRESS-SUPPRESSION BOUNDARY, WHICH THIS MUST NOT ROUTE AROUND ────────────────────────
 *
 * A store that can hold a few hundred arbitrary feed fields is a few hundred new chances to reopen
 * #48 / #59 / #105. The rule those tickets settled is that a value is masked by `listing_search_v`
 * where a view predicate can reach it, and by `suppression.ts` (keyed on the OUTCOME `address === null`)
 * where it cannot — never by a third mechanism, and never by a caller remembering a flag. Attributes
 * are joined alongside the view when they are eventually exposed, which puts them squarely in the
 * second category.
 *
 * So the exposure side is default-denied HERE, at registration, rather than left to be remembered
 * later: `is_consumer_displayable` defaults to false and `is_address_bearing` defaults to true, and a
 * CHECK forbids the combination that would leak. A field nobody has classified is therefore invisible
 * rather than public — the inverse of the column-by-column enumeration that fails open on every field
 * nobody thought about. Whatever surface eventually reads these rows filters on
 * `is_consumer_displayable` AND routes through `suppression.ts`; neither substitutes for the other.
 *
 * ── HOW GOVERNANCE IS ENFORCED ────────────────────────────────────────────────────────────────────
 *
 * By composite foreign keys, not by the writer's discipline. `src/db/mls-attributes.ts` is the only
 * module that writes these four tables — NOT `src/db/write.ts`, which owns `listings` and is asserted
 * to stay out of these — but the invariants below hold even against a manual `psql` session:
 *
 *   1. An unregistered FIELD cannot be stored     — `field_id` references `mls_fields`.
 *   2. An unregistered VALUE cannot be stored     — `value_lookup_id` references `mls_lookup_values`,
 *      and the composite `(field_id, value_lookup_id)` reference forces the value to belong to THAT
 *      field. Without the composite half, one system's `Pool` could be attached to another system's
 *      `ArchitecturalStyle` and validate.
 *   3. A field's declared SCOPE picks the table    — `(field_id, field_scope)` references
 *      `mls_fields (id, scope)` while `field_scope` is pinned by CHECK to this table's own scope, so a
 *      property-scoped fact cannot be attached to a listing and vice versa.
 *   4. A field's declared DATA TYPE picks the column — `(field_id, value_kind)` references
 *      `mls_fields (id, data_type)`, and a CHECK ties each `value_kind` to the one typed column that
 *      may be populated. A `lookup` field cannot carry a loose number, and a numeric field cannot
 *      carry a lookup reference.
 *
 * Fail-closed is therefore the database's behaviour, not a convention: an unknown value is a
 * constraint violation. The writer's job is to detect it FIRST and report it as a structured rejection
 * so an ingestion run records it (#93) rather than aborting a whole batch transaction — the same rule
 * `listing_statuses` established for unknown statuses.
 *
 * ── MARKET-AGNOSTIC (PRD §1) ──────────────────────────────────────────────────────────────────────
 *
 * There is no Bright-specific constant in this file, and this migration seeds NO fields and NO values:
 * the vocabulary arrives as rows from a `$metadata` pull (#91), not as DDL. `originating_system` is
 * part of the field's natural key, so the same RESO standard field delivered by two MLSes is two rows.
 * That is deliberate rather than redundant — entitlement, lookup vocabulary and address-bearing
 * classification all differ per system, and collapsing them onto one row would make one market's
 * governance decision silently bind another. Onboarding a second MLS is INSERTs.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // --- The field registry --------------------------------------------------------------------------
  pgm.createTable('mls_fields', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },

    // RESO OriginatingSystemName, matching `listings.source_system`. Part of the natural key: see the
    // market-agnostic note in the header for why the same standard field appears once per system.
    originating_system: { type: 'text', notNull: true },
    // The RESO resource the field belongs to (Property, Member, Office, Media, ...). Free text rather
    // than a CHECK for the same reason `listing_statuses` is a table: resources are added by RESO and
    // prefixed by each MLS, and a CHECK would need a migration to accept one.
    reso_resource: { type: 'text', notNull: true },
    // The field name exactly as the feed presents it.
    field_name: { type: 'text', notNull: true },
    // The RESO Data Dictionary name when this field IS standard; NULL when it is system-local.
    reso_standard_name: { type: 'text' },
    // Generated, so "standard or system-local" can never contradict the standard name it is derived
    // from. STORED (via expressionGenerated) because PG18 defaults a bare GENERATED to VIRTUAL and
    // virtual columns cannot be indexed.
    is_standard: {
      type: 'boolean',
      expressionGenerated: 'reso_standard_name IS NOT NULL',
    },

    // The typed-value discriminator. Note what is ABSENT: there is no 'string'/'text' member, and
    // adding one would reopen the free-text bag this model exists to keep closed.
    data_type: {
      type: 'text',
      notNull: true,
      check: "data_type IN ('integer','decimal','boolean','date','timestamp','lookup')",
    },
    // Which attribute table may carry this field. 'property' is for facts durable across offers (a
    // construction material); 'listing' is for offer-scoped facts (a concession). The distinction
    // mirrors the properties/listings split the service already makes, and is FK-enforced below.
    scope: {
      type: 'text',
      notNull: true,
      check: "scope IN ('listing','property')",
    },
    // Units for a numeric field, so ingestion does not have to guess whether 1850 is feet or metres.
    unit_of_measure: { type: 'text' },

    // --- Disclosure classification: BOTH DEFAULT TO THE SAFE SIDE ---------------------------------
    // A large incoming field set is a large number of new chances to leak a suppressed address, and
    // the existing suppression rule enumerates columns one at a time — which fails OPEN on every field
    // nobody thought about (#53). So a newly registered field is presumed address-bearing until a
    // human reviews it and says otherwise. Registering a field is an INSERT; declassifying one is a
    // deliberate UPDATE.
    is_address_bearing: { type: 'boolean', notNull: true, default: true },
    // The exposure switch, default-deny for the same reason. NOTHING is exposed to a consumer in this
    // ticket; this column is what a later exposure change reads instead of re-deciding per field. A
    // field that is address-bearing must never be consumer-displayable, asserted below.
    is_consumer_displayable: { type: 'boolean', notNull: true, default: false },

    // Retiring a field keeps the attributes already written (they are historical fact) while refusing
    // new ones. Enforced by the writer, not by DDL: a CHECK here cannot see the attribute rows.
    retired_at: { type: 'timestamptz' },
    // Why this field is registered / how it was classified. Governance metadata authored by us about
    // the schema — never listing content, and never rendered to a consumer.
    notes: { type: 'text' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('mls_fields', 'mls_fields_identity_unique', {
    unique: ['originating_system', 'reso_resource', 'field_name'],
  });

  // Default-deny, stated as a constraint rather than trusted to the person writing the INSERT: a field
  // that can re-identify a suppressed address is not displayable to a consumer, full stop.
  pgm.addConstraint('mls_fields', 'mls_fields_address_bearing_not_displayable', {
    check: 'NOT (is_address_bearing AND is_consumer_displayable)',
  });

  // A unit of measure on a non-numeric field is a mapping mistake, and a silent one.
  pgm.addConstraint('mls_fields', 'mls_fields_unit_requires_numeric', {
    check: "unit_of_measure IS NULL OR data_type IN ('integer','decimal')",
  });

  // The three composite targets the governance FKs below reference. Each is redundant with the primary
  // key on its own, and exists solely so `(id, x)` can be the target of a foreign key — which is how
  // the registry's declarations become constraints instead of comments.
  pgm.addConstraint('mls_fields', 'mls_fields_id_scope_unique', { unique: ['id', 'scope'] });
  pgm.addConstraint('mls_fields', 'mls_fields_id_data_type_unique', {
    unique: ['id', 'data_type'],
  });

  pgm.createIndex('mls_fields', ['originating_system', 'reso_resource'], {
    name: 'idx_mls_fields_system_resource',
  });

  pgm.createTrigger('mls_fields', 'mls_fields_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  // --- The lookup-value registry -------------------------------------------------------------------
  // Generalises the `listing_statuses` precedent from one field to every enumerated field. Adding a
  // permitted value is an INSERT; the vocabularies (Features, Styles, Views) are hundreds of values
  // that change without our involvement, and a migration per change would mean rejecting a listing
  // until someone shipped one.
  pgm.createTable('mls_lookup_values', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    field_id: { type: 'uuid', notNull: true },
    // Pinned to 'lookup' by the CHECK below and tied to the field's declared type by the composite FK,
    // so a value cannot be attached to a field that is not enumerated in the first place.
    field_data_type: { type: 'text', notNull: true, default: 'lookup' },

    // The value exactly as the feed presents it — the match target on ingest.
    value: { type: 'text', notNull: true },
    // The display label. Governed content: it reaches a consumer surface only through a later,
    // separate change, and it is reviewed at registration time like every other row here.
    label: { type: 'text', notNull: true },
    // The RESO Data Dictionary value this maps onto, where one exists. This is what lets a second MLS
    // that spells the same concept differently normalise onto one queryable value.
    reso_standard_value: { type: 'text' },
    sort_order: { type: 'integer', notNull: true, default: 0 },
    retired_at: { type: 'timestamptz' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('mls_lookup_values', 'mls_lookup_values_field_is_lookup', {
    check: "field_data_type = 'lookup'",
  });

  pgm.addConstraint('mls_lookup_values', 'mls_lookup_values_field_fk', {
    foreignKeys: {
      columns: ['field_id', 'field_data_type'],
      references: 'mls_fields (id, data_type)',
      onDelete: 'RESTRICT',
    },
  });

  pgm.addConstraint('mls_lookup_values', 'mls_lookup_values_value_unique', {
    unique: ['field_id', 'value'],
  });

  // The composite target for rule 2 in the header: an attribute's lookup reference must belong to the
  // same field the attribute is for.
  pgm.addConstraint('mls_lookup_values', 'mls_lookup_values_field_id_unique', {
    unique: ['field_id', 'id'],
  });

  pgm.createTrigger('mls_lookup_values', 'mls_lookup_values_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });

  // --- The typed attribute stores ------------------------------------------------------------------
  // Two tables rather than one with two nullable owner columns: each keeps a non-null leading index
  // column for the "every attribute for one entity" read, and neither needs a XOR check to stay
  // honest about which entity it belongs to.
  const attributeColumns = (owner, ownerTable) => ({
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    [owner]: {
      type: 'uuid',
      notNull: true,
      references: ownerTable,
      // CASCADE, unlike `listing_events`' RESTRICT: an attribute is a restatement of the current feed
      // payload, not history with independent value, so it must not outlive its owner and must not
      // block the `is_sample` re-seed sweep. Sample attributes are removed by the cascade from
      // `DELETE FROM listings WHERE is_sample`, which is why there is no `is_sample` column here.
      onDelete: 'CASCADE',
    },
    field_id: { type: 'uuid', notNull: true },

    // The two governance discriminators. Both are denormalised copies of a `mls_fields` column, and
    // both exist only to be the second half of a composite foreign key — see the header.
    field_scope: { type: 'text', notNull: true },
    value_kind: { type: 'text', notNull: true },

    // --- The typed value. Exactly one of these is populated, and which one is dictated by the field's
    // registered data type. THERE IS NO TEXT COLUMN HERE. Do not add one.
    //
    // One numeric column covers both integer and decimal: it sorts and range-scans without a cast,
    // which a text column could not, and splitting it would double every reverse index for no gain.
    // The `integer` kind is held to whole numbers by the CHECK below rather than by a narrower type.
    value_numeric: { type: 'numeric(20,6)' },
    value_boolean: { type: 'boolean' },
    value_date: { type: 'date' },
    value_timestamp: { type: 'timestamptz' },
    value_lookup_id: { type: 'uuid' },

    // Feed freshness for this attribute, distinct from `updated_at`, exactly as `listings.last_updated`
    // is. An MLS sync rewrites rows wholesale, so `updated_at` moves whether or not the value changed.
    source_modification_timestamp: { type: 'timestamptz' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Ties each `value_kind` to the single typed column it may populate, and forbids populating any
  // other. `num_nonnulls(...) = 1` is the half that stops a second value riding along unnoticed; the
  // per-kind clause is the half that stops a lookup field carrying a loose number.
  const VALUE_SHAPE_CHECK =
    'num_nonnulls(value_numeric, value_boolean, value_date, value_timestamp, value_lookup_id) = 1 ' +
    "AND ((value_kind = 'integer'   AND value_numeric IS NOT NULL AND value_numeric = trunc(value_numeric)) " +
    "  OR (value_kind = 'decimal'   AND value_numeric IS NOT NULL) " +
    "  OR (value_kind = 'boolean'   AND value_boolean IS NOT NULL) " +
    "  OR (value_kind = 'date'      AND value_date IS NOT NULL) " +
    "  OR (value_kind = 'timestamp' AND value_timestamp IS NOT NULL) " +
    "  OR (value_kind = 'lookup'    AND value_lookup_id IS NOT NULL))";

  for (const [table, owner, ownerTable, scope] of [
    ['listing_attributes', 'listing_id', 'listings', 'listing'],
    ['property_attributes', 'property_id', 'properties', 'property'],
  ]) {
    pgm.createTable(table, attributeColumns(owner, ownerTable));

    pgm.addConstraint(table, `${table}_scope_pinned`, {
      check: `field_scope = '${scope}'`,
    });

    // Rule 3: the field's registered scope decides which of these two tables may reference it.
    pgm.addConstraint(table, `${table}_field_scope_fk`, {
      foreignKeys: {
        columns: ['field_id', 'field_scope'],
        references: 'mls_fields (id, scope)',
        onDelete: 'RESTRICT',
      },
    });

    // Rule 4: the field's registered data type decides which typed column may be populated.
    pgm.addConstraint(table, `${table}_field_data_type_fk`, {
      foreignKeys: {
        columns: ['field_id', 'value_kind'],
        references: 'mls_fields (id, data_type)',
        onDelete: 'RESTRICT',
      },
    });

    pgm.addConstraint(table, `${table}_value_shape`, { check: VALUE_SHAPE_CHECK });

    // Rule 2: a lookup reference must be a registered value OF THIS FIELD.
    pgm.addConstraint(table, `${table}_lookup_value_fk`, {
      foreignKeys: {
        columns: ['field_id', 'value_lookup_id'],
        references: 'mls_lookup_values (field_id, id)',
        onDelete: 'RESTRICT',
      },
    });

    // Single- vs multi-valued falls out of this index instead of needing a flag on the field: a scalar
    // attribute has a NULL `value_lookup_id`, so NULLS NOT DISTINCT lets it exist exactly once, while
    // an enumerated field may carry many rows as long as the VALUES differ. A feed that repeats a
    // value in one payload is therefore idempotent rather than duplicated.
    //
    // It is also access pattern #1 — every attribute for one entity — since `${owner}` leads it.
    pgm.createIndex(table, [owner, 'field_id', 'value_lookup_id'], {
      unique: true,
      nulls: 'not distinct',
      name: `idx_${table}_owner_field_value`,
    });

    // Access pattern #2 — find entities having a given field/value — is the reverse direction, so it
    // needs its own indexes led by `field_id`. Partial per value kind so each stays small and so the
    // ordering column is meaningful (a range scan over `value_numeric` is the point of not storing it
    // as text). Booleans/dates/timestamps are left to the `field_id` prefix of these two for now;
    // #51 owns tuning this against real volume and real query shapes, not this ticket.
    pgm.createIndex(table, ['field_id', 'value_lookup_id', owner], {
      where: 'value_lookup_id IS NOT NULL',
      name: `idx_${table}_field_lookup`,
    });
    pgm.createIndex(table, ['field_id', 'value_numeric', owner], {
      where: 'value_numeric IS NOT NULL',
      name: `idx_${table}_field_numeric`,
    });

    pgm.createTrigger(table, `${table}_set_updated_at`, {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'set_updated_at',
    });
  }
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('listing_attributes');
  pgm.dropTable('property_attributes');
  pgm.dropTable('mls_lookup_values');
  pgm.dropTable('mls_fields');
};
