import {
  AGENT_BUYER_AGREEMENT_REMINDER,
  type AgentDeclineReason,
  type AgentLeadDetail,
  type AgentLeadListItem,
  type ConsentChannel,
  type LeadStatus,
} from '@cribstop/property-contracts';
import {
  type AccountContact,
  contactName,
  type ContactsClient,
} from '../inquiries/account-contacts';
import type { Queryable } from '../inquiries/write';
import { maskEmail, maskPhone } from '../staff/leads-store';

/**
 * Reads and writes for the agent "My leads" API (#636). Every query joins on the OPEN assignment of
 * the caller's profile, so a lead of another agent, or an unassigned lead, never matches. Status
 * changes go through `changeLeadStatus`.
 */

/** More open leads than this is not a dashboard. */
const LIST_LIMIT = 200;

/** The active profile of an account, or `null`. */
export async function findActiveAgentProfileId(
  pool: Queryable,
  accountId: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM agent_profiles WHERE account_id = $1 AND active',
    [accountId],
  );
  return rows[0]?.id ?? null;
}

/** Does this profile hold the open assignment of the lead? */
export async function ownsOpenAssignment(
  db: Queryable,
  leadId: string,
  agentProfileId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM lead_assignments
      WHERE lead_id = $1 AND agent_profile_id = $2 AND ended_at IS NULL`,
    [leadId, agentProfileId],
  );
  return rows.length > 0;
}

/** Records the accept time on the open assignment. Runs inside the status transaction. */
export async function markAccepted(
  client: Queryable,
  leadId: string,
  agentProfileId: string,
): Promise<void> {
  await client.query(
    `UPDATE lead_assignments SET accepted_at = now()
      WHERE lead_id = $1 AND agent_profile_id = $2 AND ended_at IS NULL`,
    [leadId, agentProfileId],
  );
}

/** Records the decline reason on the open assignment. The status change ends the row. */
export async function markDeclineReason(
  client: Queryable,
  leadId: string,
  agentProfileId: string,
  reason: AgentDeclineReason,
): Promise<void> {
  await client.query(
    `UPDATE lead_assignments SET decline_reason = $3
      WHERE lead_id = $1 AND agent_profile_id = $2 AND ended_at IS NULL`,
    [leadId, agentProfileId, reason],
  );
}

interface Row {
  id: string;
  created_at: Date;
  assigned_at: Date;
  accepted_at: Date | null;
  kind: AgentLeadListItem['kind'];
  status: LeadStatus;
  account_id: string;
  phone: string | null;
  message: string | null;
  consent_to_contact: boolean;
  consent_disclosure_text: string | null;
  consent_channels: ConsentChannel[] | null;
  consent_given_at: Date | null;
  listing_id: string;
  listing_title: string;
  listing_address: string;
  listing_state: string | null;
  listing_price: string | number | null;
  listing_status: string | null;
}

const SELECT = `
  SELECT i.id, i.created_at, a.assigned_at, a.accepted_at, i.kind, i.status, i.account_id,
         i.phone, i.message, i.consent_to_contact, i.consent_disclosure_text,
         i.consent_channels, i.consent_given_at, i.listing_id,
         l.title AS listing_title, p.address_raw AS listing_address, p.state AS listing_state,
         l.list_price AS listing_price, l.consumer_status AS listing_status
    FROM lead_assignments a
    JOIN listing_inquiries i ON i.id = a.lead_id
    JOIN listings l ON l.id = i.listing_id
    JOIN properties p ON p.id = l.property_id`;

const toListItem = (row: Row, contact: AccountContact | undefined): AgentLeadListItem => ({
  id: row.id,
  createdAt: row.created_at.toISOString(),
  assignedAt: row.assigned_at.toISOString(),
  acceptedAt: row.accepted_at?.toISOString() ?? null,
  kind: row.kind,
  status: row.status,
  listing: {
    id: row.listing_id,
    title: row.listing_title,
    address: row.listing_address,
    state: row.listing_state,
    listPrice: row.listing_price === null ? null : Number(row.listing_price),
    status: row.listing_status,
  },
  emailMasked: contact?.email ? maskEmail(contact.email) : null,
  phoneMasked: maskPhone(row.phone),
});

/** One contact lookup per call. A failed lookup leaves `emailMasked` null. */
export async function listAgentLeads(
  pool: Queryable,
  contacts: ContactsClient,
  agentProfileId: string,
  status: LeadStatus | undefined,
): Promise<AgentLeadListItem[]> {
  const params: unknown[] = [agentProfileId];
  let statusSql = '';
  if (status !== undefined) {
    params.push(status);
    statusSql = 'AND i.status = $2';
  }
  const { rows } = await pool.query<Row>(
    `${SELECT}
      WHERE a.agent_profile_id = $1 AND a.ended_at IS NULL ${statusSql}
      ORDER BY a.assigned_at DESC, i.id DESC
      LIMIT ${LIST_LIMIT}`,
    params,
  );
  const found = await contacts.lookup(rows.map((row) => row.account_id));
  return rows.map((row) => toListItem(row, found.get(row.account_id)));
}

/**
 * The lead of the caller, or `null` when the caller holds no open assignment on it. Writes the
 * access-audit row BEFORE it returns the row, and a failed insert rejects, so no detail read goes
 * unrecorded. Contact details leave only when the status is past `assigned`. The lookup runs beside
 * the audit insert, and a failed lookup leaves `name` and `email` null.
 */
export async function readAgentLeadDetail(
  pool: Queryable,
  contacts: ContactsClient,
  agentProfileId: string,
  leadId: string,
  actor: { accountId: string },
): Promise<AgentLeadDetail | null> {
  const { rows } = await pool.query<Row>(
    `${SELECT}
      WHERE i.id = $1 AND a.agent_profile_id = $2 AND a.ended_at IS NULL`,
    [leadId, agentProfileId],
  );
  const row = rows[0];
  if (row === undefined) return null;

  // The lookup runs beside the audit insert. The response still waits for the insert.
  const [, found] = await Promise.all([
    pool.query(
      'INSERT INTO lead_access_audit (lead_id, actor_account_id, actor_role) VALUES ($1, $2, $3)',
      [leadId, actor.accountId, 'Agent'],
    ),
    contacts.lookup([row.account_id]),
  ]);

  const revealed = row.status !== 'assigned';
  const contact = found.get(row.account_id);
  return {
    ...toListItem(row, contact),
    contact: revealed
      ? {
          name: contact ? contactName(contact) : null,
          email: contact?.email ?? null,
          phone: row.phone,
          message: row.message,
          consent: {
            given: row.consent_to_contact,
            text: row.consent_disclosure_text,
            channels: row.consent_channels ?? [],
            givenAt: row.consent_given_at?.toISOString() ?? null,
          },
        }
      : null,
    buyerAgreementReminder: AGENT_BUYER_AGREEMENT_REMINDER,
  };
}
