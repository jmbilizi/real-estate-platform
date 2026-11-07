import {
  AGENT_BROKERAGE,
  type AgentProfile,
  type CreateAgentProfileRequest,
  type StaffAgentsRequest,
  type UpdateAgentProfileRequest,
} from '@cribstop/property-contracts';
import {
  changeLeadStatusInTransaction,
  type TransactionalPool,
} from '../inquiries/lead-status-write';
import type { Queryable } from '../inquiries/write';

/** Reads and writes for the agent directory (#634). */

/** More profiles than this is not a directory a person picks from. */
const LIST_LIMIT = 500;

interface AgentRow {
  id: string;
  account_id: string;
  display_name: string;
  licence_number: string;
  licence_states: string[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS =
  'id, account_id, display_name, licence_number, licence_states, active, created_at, updated_at';

const toProfile = (row: AgentRow): AgentProfile => ({
  id: row.id,
  accountId: row.account_id,
  displayName: row.display_name,
  licenceNumber: row.licence_number,
  licenceStates: row.licence_states,
  brokerage: AGENT_BROKERAGE,
  active: row.active,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export async function listAgents(
  pool: Queryable,
  filters: StaffAgentsRequest,
): Promise<AgentProfile[]> {
  const params: unknown[] = [];
  // A pseudonymised profile (#992) has no account and no place in the directory.
  const where: string[] = ['account_id IS NOT NULL'];
  if (filters.active !== undefined) {
    params.push(filters.active === 'true');
    where.push(`active = $${params.length}`);
  }
  if (filters.licenceState !== undefined) {
    params.push(filters.licenceState);
    where.push(`$${params.length} = ANY (licence_states)`);
  }
  const { rows } = await pool.query<AgentRow>(
    `SELECT ${COLUMNS} FROM agent_profiles
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY display_name, id LIMIT ${LIST_LIMIT}`,
    params,
  );
  return rows.map(toProfile);
}

export async function getAgent(pool: Queryable, id: string): Promise<AgentProfile | null> {
  const { rows } = await pool.query<AgentRow>(
    `SELECT ${COLUMNS} FROM agent_profiles WHERE id = $1 AND account_id IS NOT NULL`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toProfile(row);
}

const UNIQUE_VIOLATION = '23505';

/** `null` when the account already has a profile. */
export async function createAgent(
  pool: Queryable,
  input: CreateAgentProfileRequest,
): Promise<AgentProfile | null> {
  try {
    const { rows } = await pool.query<AgentRow>(
      `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [
        input.accountId,
        input.displayName,
        input.licenceNumber,
        input.licenceStates,
        input.active ?? true,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('agent insert returned no row');
    return toProfile(row);
  } catch (error) {
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return null;
    throw error;
  }
}

/** `null` when no profile has this id. Only the fields in `patch` change. */
export async function updateAgent(
  pool: Queryable,
  id: string,
  patch: UpdateAgentProfileRequest,
): Promise<AgentProfile | null> {
  const { rows } = await pool.query<AgentRow>(
    `UPDATE agent_profiles
        SET display_name = COALESCE($2, display_name),
            licence_number = COALESCE($3, licence_number),
            licence_states = COALESCE($4, licence_states),
            active = COALESCE($5, active),
            updated_at = now()
      WHERE id = $1 AND account_id IS NOT NULL
      RETURNING ${COLUMNS}`,
    [
      id,
      patch.displayName ?? null,
      patch.licenceNumber ?? null,
      patch.licenceStates ?? null,
      patch.active ?? null,
    ],
  );
  const row = rows[0];
  return row === undefined ? null : toProfile(row);
}

/**
 * The assign check, inside the status transaction. Returns a rejection code, or `null` when the
 * agent may take the lead. Only the licence state and the listing state decide a match.
 */
export async function checkAgentForLead(
  client: Queryable,
  leadId: string,
  agentProfileId: string,
): Promise<'agent_not_found' | 'agent_inactive' | 'agent_not_licensed' | null> {
  const agent = await client.query<{ active: boolean; licence_states: string[] }>(
    'SELECT active, licence_states FROM agent_profiles WHERE id = $1 AND account_id IS NOT NULL FOR SHARE',
    [agentProfileId],
  );
  const profile = agent.rows[0];
  if (profile === undefined) return 'agent_not_found';
  if (!profile.active) return 'agent_inactive';

  const listing = await client.query<{ state: string }>(
    `SELECT upper(btrim(p.state)) AS state
       FROM listing_inquiries i
       JOIN listings l ON l.id = i.listing_id
       JOIN properties p ON p.id = l.property_id
      WHERE i.id = $1`,
    [leadId],
  );
  const state = listing.rows[0]?.state;
  return state !== undefined && profile.licence_states.includes(state)
    ? null
    : 'agent_not_licensed';
}

/** Opens the assignment. The partial unique index allows one open row per lead. */
export async function openAssignment(
  client: Queryable,
  input: { leadId: string; agentProfileId: string; assignedByAccountId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO lead_assignments (lead_id, agent_profile_id, assigned_by_account_id)
     VALUES ($1, $2, $3)`,
    [input.leadId, input.agentProfileId, input.assignedByAccountId],
  );
}

export async function hasOpenAssignment(client: Queryable, leadId: string): Promise<boolean> {
  const { rows } = await client.query(
    'SELECT 1 FROM lead_assignments WHERE lead_id = $1 AND ended_at IS NULL',
    [leadId],
  );
  return rows.length > 0;
}

export const AGENT_ERASED_NOTE = 'agent account erased';

export interface AgentErasureResult {
  agentProfilesPseudonymised: number;
  leadAssignmentsKept: number;
  leadsReturnedToQueue: number;
}

/**
 * Account deletion (#992, #1007). Pseudonymises the agent profile of the account and never deletes
 * it. The brokerage record keeps the licensee for 5 years (MD BOP 17-507, VA 18VAC135-20-185). The
 * row keeps `display_name`, `licence_number`, `licence_states`, `brokerage` and the dates. It loses
 * the `account_id` link, so no login maps to it, and becomes inactive with `deactivated_at` set.
 * `lead_assignments` and `lead_status_events` keep `agent_profile_id`.
 *
 * In the same transaction, each lead still `assigned` or `accepted` with this agent returns to
 * `verified` through `changeLeadStatusInTransaction`: system actor, end reason `returned`, one
 * appended event. Later statuses have no transition to `verified`, so they keep the assignment and
 * staff see `needsReassignment`. The open leads are locked before the profile update, the same
 * order as staff assign. After the update, an assign that waited on the profile finds no
 * `account_id` and fails, so no assignment opens on a profile this call missed. A second call finds
 * no linked profile and changes nothing.
 */
export async function eraseAccountAgent(
  pool: TransactionalPool,
  accountId: string,
): Promise<AgentErasureResult> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    // Lock order: lead rows (by id), then the profile. Staff assign locks the lead, then reads the
    // profile `FOR SHARE`. The same order means the two never wait on each other in a cycle.
    await client.query(
      `SELECT i.id FROM listing_inquiries i
        WHERE i.id IN (SELECT la.lead_id FROM lead_assignments la
                         JOIN agent_profiles p ON p.id = la.agent_profile_id
                        WHERE p.account_id = $1 AND la.ended_at IS NULL)
        ORDER BY i.id FOR UPDATE`,
      [accountId],
    );
    const scrubbed = await client.query<{ id: string }>(
      `UPDATE agent_profiles
          SET account_id = NULL, active = false, deactivated_at = now()
        WHERE account_id = $1
        RETURNING id`,
      [accountId],
    );
    const profileIds = scrubbed.rows.map((row) => row.id);
    if (profileIds.length === 0) {
      await client.query('COMMIT');
      return { agentProfilesPseudonymised: 0, leadAssignmentsKept: 0, leadsReturnedToQueue: 0 };
    }

    const kept = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM lead_assignments WHERE agent_profile_id = ANY($1::uuid[])',
      [profileIds],
    );
    // Ordered by lead id, so two erasures that share a lead lock in the same order.
    const open = await client.query<{ lead_id: string; agent_profile_id: string }>(
      `SELECT a.lead_id, a.agent_profile_id
         FROM lead_assignments a
         JOIN listing_inquiries i ON i.id = a.lead_id
        WHERE a.agent_profile_id = ANY($1::uuid[]) AND a.ended_at IS NULL
          AND i.status IN ('assigned', 'accepted')
        ORDER BY a.lead_id`,
      [profileIds],
    );
    let returned = 0;
    for (const row of open.rows) {
      const result = await changeLeadStatusInTransaction(client, {
        leadId: row.lead_id,
        to: 'verified',
        actorAccountId: null,
        actorRole: 'system',
        note: AGENT_ERASED_NOTE,
        assignmentEndReason: 'returned',
        // A staff change between the select and the row lock can end the assignment or move the
        // lead on. The change is then skipped.
        precheck: async (db) => {
          const still = await db.query(
            `SELECT 1 FROM lead_assignments
              WHERE lead_id = $1 AND agent_profile_id = $2 AND ended_at IS NULL`,
            [row.lead_id, row.agent_profile_id],
          );
          return still.rows.length > 0 ? null : 'assignment_changed';
        },
      });
      if (result.ok) returned += 1;
    }
    await client.query('COMMIT');
    return {
      agentProfilesPseudonymised: profileIds.length,
      leadAssignmentsKept: kept.rows[0]?.count ?? 0,
      leadsReturnedToQueue: returned,
    };
  } catch (error) {
    // A failed ROLLBACK means a broken connection. Release it with the error so the pool drops it.
    releaseError = await client.query('ROLLBACK').then(
      () => undefined,
      (rollbackError: unknown) =>
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
    );
    throw error;
  } finally {
    client.release(releaseError);
  }
}
