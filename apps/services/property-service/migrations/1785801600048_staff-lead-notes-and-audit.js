exports.shorthands = undefined;

/**
 * Staff lead desk tables (#632).
 *
 * - `lead_notes`: internal staff notes. Append-only, with author and time.
 * - `lead_access_audit`: one row per staff detail read (actor, role, lead, time). Append-only.
 * - Two expression indexes serve the possible-duplicate lookup: same listing, same normalized
 *   email, or same normalized phone (the last ten digits).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('lead_notes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: 'listing_inquiries',
      onDelete: 'CASCADE',
    },
    author_account_id: { type: 'uuid', notNull: true },
    author_role: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('lead_notes', 'lead_notes_body_check', {
    check: "btrim(body) <> '' AND char_length(body) <= 2000",
  });
  pgm.createIndex('lead_notes', ['lead_id', 'created_at'], { name: 'idx_lead_notes_lead' });

  pgm.createTable('lead_access_audit', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: 'listing_inquiries',
      onDelete: 'CASCADE',
    },
    actor_account_id: { type: 'uuid', notNull: true },
    actor_role: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('lead_access_audit', ['lead_id', 'created_at'], {
    name: 'idx_lead_access_audit_lead',
  });

  // Same rule as `lead_status_events`: an UPDATE, a TRUNCATE or a direct DELETE fails. A DELETE
  // passes only when the parent lead is gone (the FK cascade of a future retention purge).
  pgm.createFunction(
    'lead_staff_rows_append_only',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       IF TG_OP = 'DELETE' THEN
         IF NOT EXISTS (SELECT 1 FROM listing_inquiries WHERE id = OLD.lead_id) THEN
           RETURN OLD;
         END IF;
       END IF;
       RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
     END;`,
  );
  for (const table of ['lead_notes', 'lead_access_audit']) {
    pgm.createTrigger(table, `${table}_append_only`, {
      when: 'BEFORE',
      operation: ['UPDATE', 'DELETE'],
      level: 'ROW',
      function: 'lead_staff_rows_append_only',
    });
    pgm.createTrigger(table, `${table}_no_truncate`, {
      when: 'BEFORE',
      operation: 'TRUNCATE',
      level: 'STATEMENT',
      function: 'lead_staff_rows_append_only',
    });
  }

  pgm.sql(
    `CREATE INDEX idx_listing_inquiries_dup_email
       ON listing_inquiries (listing_id, lower(btrim(email)), created_at)`,
  );
  pgm.sql(
    `CREATE INDEX idx_listing_inquiries_dup_phone
       ON listing_inquiries (listing_id, (NULLIF(right(regexp_replace(phone, '\\D', '', 'g'), 10), '')), created_at)
       WHERE phone IS NOT NULL`,
  );
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS idx_listing_inquiries_dup_phone');
  pgm.sql('DROP INDEX IF EXISTS idx_listing_inquiries_dup_email');
  pgm.dropTable('lead_access_audit');
  pgm.dropTable('lead_notes');
  pgm.dropFunction('lead_staff_rows_append_only', []);
};
