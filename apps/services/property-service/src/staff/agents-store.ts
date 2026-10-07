import {
  AGENT_BROKERAGE,
  type AgentProfile,
  type CreateAgentProfileRequest,
  type StaffAgentsRequest,
  type UpdateAgentProfileRequest,
} from '@cribstop/property-contracts';
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
  const where: string[] = [];
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
    `SELECT ${COLUMNS} FROM agent_profiles WHERE id = $1`,
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
      WHERE id = $1
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
    'SELECT active, licence_states FROM agent_profiles WHERE id = $1 FOR SHARE',
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
