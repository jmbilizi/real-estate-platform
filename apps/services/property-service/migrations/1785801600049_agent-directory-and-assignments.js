exports.shorthands = undefined;

const END_REASONS = ['unassigned', 'returned', 'closed'];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

/**
 * Agent directory and lead assignments (#634).
 *
 * - `agent_profiles`: one row per account that holds the `Agent` role. `account_id` has no FK:
 *   account-service owns accounts. The profile holds no trait of any buyer (Fair Housing).
 * - `lead_assignments`: the assignment history. A partial unique index allows one OPEN row per
 *   lead. Rows are never deleted. A row ends once, and only the end columns change.
 * - `lead_status_events.agent_profile_id`: the agent an assign or unassign event names.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createTable('agent_profiles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    account_id: { type: 'uuid', notNull: true, unique: true },
    display_name: { type: 'text', notNull: true },
    licence_number: { type: 'text', notNull: true },
    licence_states: { type: 'text[]', notNull: true },
    brokerage: { type: 'text', notNull: true, default: 'Real Broker, LLC' },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('agent_profiles', 'agent_profiles_text_check', {
    check:
      "btrim(display_name) <> '' AND char_length(display_name) <= 100 " +
      "AND btrim(licence_number) <> '' AND char_length(licence_number) <= 40",
  });
  // Two-letter codes only. The set of markets is data, not DDL.
  pgm.addConstraint('agent_profiles', 'agent_profiles_licence_states_check', {
    check:
      'cardinality(licence_states) BETWEEN 1 AND 60 ' +
      "AND array_to_string(licence_states, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'",
  });
  pgm.createIndex('agent_profiles', ['active', 'display_name'], {
    name: 'idx_agent_profiles_active_name',
  });

  pgm.createTable('lead_assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: 'listing_inquiries',
      onDelete: 'CASCADE',
    },
    agent_profile_id: { type: 'uuid', notNull: true, references: 'agent_profiles' },
    assigned_by_account_id: { type: 'uuid', notNull: true },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ended_at: { type: 'timestamptz' },
    end_reason: { type: 'text' },
  });
  pgm.addConstraint('lead_assignments', 'lead_assignments_end_check', {
    check: `(ended_at IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND end_reason IN (${list(END_REASONS)}))`,
  });
  pgm.createIndex('lead_assignments', 'lead_id', {
    name: 'uq_lead_assignments_one_open',
    unique: true,
    where: 'ended_at IS NULL',
  });
  pgm.createIndex('lead_assignments', ['lead_id', 'assigned_at'], {
    name: 'idx_lead_assignments_lead',
  });
  pgm.createIndex('lead_assignments', ['agent_profile_id', 'assigned_at'], {
    name: 'idx_lead_assignments_agent',
  });

  // A DELETE passes only when the parent lead is gone (the FK cascade of a future retention purge).
  pgm.createFunction(
    'lead_assignments_guard',
    [],
    { returns: 'trigger', language: 'plpgsql' },
    `BEGIN
       IF TG_OP = 'UPDATE' THEN
         IF OLD.ended_at IS NULL
            AND NEW.id = OLD.id AND NEW.lead_id = OLD.lead_id
            AND NEW.agent_profile_id = OLD.agent_profile_id
            AND NEW.assigned_by_account_id = OLD.assigned_by_account_id
            AND NEW.assigned_at = OLD.assigned_at THEN
           RETURN NEW;
         END IF;
       ELSIF TG_OP = 'DELETE' THEN
         IF NOT EXISTS (SELECT 1 FROM listing_inquiries WHERE id = OLD.lead_id) THEN
           RETURN OLD;
         END IF;
       END IF;
       RAISE EXCEPTION 'lead_assignments keeps its history' USING ERRCODE = 'integrity_constraint_violation';
     END;`,
  );
  pgm.createTrigger('lead_assignments', 'lead_assignments_guard', {
    when: 'BEFORE',
    operation: ['UPDATE', 'DELETE'],
    level: 'ROW',
    function: 'lead_assignments_guard',
  });
  pgm.createTrigger('lead_assignments', 'lead_assignments_no_truncate', {
    when: 'BEFORE',
    operation: 'TRUNCATE',
    level: 'STATEMENT',
    function: 'lead_assignments_guard',
  });

  pgm.addColumn('lead_status_events', {
    agent_profile_id: { type: 'uuid', references: 'agent_profiles' },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropColumn('lead_status_events', 'agent_profile_id');
  pgm.dropTable('lead_assignments');
  pgm.dropFunction('lead_assignments_guard', []);
  pgm.dropTable('agent_profiles');
};
