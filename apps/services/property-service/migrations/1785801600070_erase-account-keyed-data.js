exports.shorthands = undefined;

/**
 * Account erasure (#992). Lets the erasure of an account keep the lead history without the agent.
 *
 * - `notification_outbox.recipient_account_id` allows NULL. A sent row keeps its place with no
 *   recipient.
 * - `lead_assignments.agent_profile_id` and `lead_status_events.agent_profile_id` become
 *   `ON DELETE SET NULL`. Deleting an `agent_profiles` row detaches its history rows.
 * - The two guard triggers accept one extra change: `agent_profile_id` going from a value to NULL
 *   with every other column unchanged, and only inside the foreign key action
 *   (`pg_trigger_depth() > 1`). A direct UPDATE has depth 1, so it keeps its old rule.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.alterColumn('notification_outbox', 'recipient_account_id', { notNull: false });
  pgm.alterColumn('lead_assignments', 'agent_profile_id', { notNull: false });

  for (const table of ['lead_assignments', 'lead_status_events']) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_agent_profile_id_fkey`);
    pgm.sql(
      `ALTER TABLE ${table} ADD CONSTRAINT ${table}_agent_profile_id_fkey
         FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles (id) ON DELETE SET NULL`,
    );
  }

  const detachOnly =
    "pg_trigger_depth() > 1 AND OLD.agent_profile_id IS NOT NULL AND NEW.agent_profile_id IS NULL AND (to_jsonb(NEW) - 'agent_profile_id') = (to_jsonb(OLD) - 'agent_profile_id')";

  pgm.createFunction(
    'lead_assignments_guard',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `BEGIN
       IF TG_OP = 'UPDATE' THEN
         IF ${detachOnly} THEN
           RETURN NEW;
         END IF;
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
  pgm.createFunction(
    'lead_status_events_append_only',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `BEGIN
       IF TG_OP = 'UPDATE' THEN
         IF ${detachOnly} THEN
           RETURN NEW;
         END IF;
       ELSIF TG_OP = 'DELETE' THEN
         IF NOT EXISTS (SELECT 1 FROM listing_inquiries WHERE id = OLD.lead_id) THEN
           RETURN OLD;
         END IF;
       END IF;
       RAISE EXCEPTION 'lead_status_events is append-only' USING ERRCODE = 'integrity_constraint_violation';
     END;`,
  );
};

/**
 * Restores each NOT NULL rule only while no erased row exists. An erased row keeps its NULL, so
 * the column stays nullable. The down never deletes audit rows.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.createFunction(
    'lead_status_events_append_only',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `BEGIN
       IF TG_OP = 'DELETE' THEN
         IF NOT EXISTS (SELECT 1 FROM listing_inquiries WHERE id = OLD.lead_id) THEN
           RETURN OLD;
         END IF;
       END IF;
       RAISE EXCEPTION 'lead_status_events is append-only' USING ERRCODE = 'integrity_constraint_violation';
     END;`,
  );
  pgm.createFunction(
    'lead_assignments_guard',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
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
  for (const table of ['lead_assignments', 'lead_status_events']) {
    pgm.sql(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_agent_profile_id_fkey`);
    pgm.sql(
      `ALTER TABLE ${table} ADD CONSTRAINT ${table}_agent_profile_id_fkey
         FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles (id)`,
    );
  }
  for (const [table, column] of [
    ['lead_assignments', 'agent_profile_id'],
    ['notification_outbox', 'recipient_account_id'],
  ]) {
    pgm.sql(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} IS NULL) THEN
           ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;
         END IF;
       END $$`,
    );
  }
};
