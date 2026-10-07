import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';
import {
  bearerFor,
  setAccountRoles,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/** The notification outbox (#638) against a REAL service and database. */
const listing = complianceFixtureIds().sampleListingId;
const asModerator = {
  headers: bearerFor(randomUUID(), ['User', 'Moderator']),
  validateStatus: () => true,
};
const asAdmin = {
  headers: bearerFor(randomUUID(), ['User', 'Admin']),
  validateStatus: () => true,
};
let stub: Server;
const pool = () => getPool();

interface OutboxRow {
  event_type: string;
  recipient_kind: string;
  recipient_ref: string;
  recipient_ref_type: string;
  state: string;
  payload: string;
}

const outboxOf = async (leadId: string): Promise<OutboxRow[]> =>
  (
    await pool().query<OutboxRow>(
      `SELECT event_type, recipient_kind, recipient_ref, recipient_ref_type, state,
              payload::text AS payload
         FROM notification_outbox WHERE lead_id = $1 ORDER BY created_at, id`,
      [leadId],
    )
  ).rows;

async function seedLead(consentEmail: boolean): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO listing_inquiries
       (listing_id, kind, name, email, message, consent_to_contact,
        consent_disclosure_text, consent_given_at, consent_text_version, consent_channels, account_id)
     VALUES ($1, 'message', 'E2E Lead', $2, 'Hello (e2e)', $3,
             CASE WHEN $3 THEN 'text' END, CASE WHEN $3 THEN now() END,
             CASE WHEN $3 THEN 'v1' END, CASE WHEN $3 THEN ARRAY['email'] END, gen_random_uuid())
     RETURNING id`,
    [listing, `${randomUUID()}@e2e.example.com`, consentEmail],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  await pool().query(
    `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
     VALUES ($1, NULL, 'new', 'system')`,
    [id],
  );
  return id;
}

const verify = (leadId: string) =>
  axios.post(`/staff/leads/${leadId}/transition`, { to: 'verified' }, asModerator);

beforeAll(async () => {
  stub = await startIntrospectionStub();
});
afterAll(async () => {
  await stopIntrospectionStub(stub);
  await closePool();
});

describe('notification_outbox', () => {
  it('writes held buyer and agent rows with ids only, in the status transaction', async () => {
    const leadId = await seedLead(true);
    const accountId = randomUUID();
    setAccountRoles(accountId, ['User', 'Agent']);
    const created = await axios.post(
      '/staff/agents',
      {
        accountId,
        displayName: 'E2E Agent',
        licenceNumber: 'E2E-1',
        licenceStates: ['ZZ'],
        active: true,
      },
      asAdmin,
    );
    expect(created.status).toBe(201);
    const agentProfileId = (created.data as { id: string }).id;

    expect((await verify(leadId)).status).toBeLessThan(300);
    const assign = await axios.post(
      `/staff/leads/${leadId}/assign`,
      { agentProfileId },
      asModerator,
    );
    expect(assign.status).toBeLessThan(300);

    const rows = await outboxOf(leadId);
    expect(rows.map((r) => `${r.event_type}/${r.recipient_kind}`)).toEqual([
      'lead.verified/buyer',
      'lead.assigned/buyer',
      'lead.assigned/agent',
    ]);
    expect(rows.every((r) => r.state === 'held')).toBe(true);
    const { rows: owner } = await pool().query<{ account_id: string }>(
      'SELECT account_id FROM listing_inquiries WHERE id = $1',
      [leadId],
    );
    expect(rows[0]).toMatchObject({
      recipient_ref: owner[0]?.account_id,
      recipient_ref_type: 'account',
    });
    expect(rows[2]).toMatchObject({
      recipient_ref: agentProfileId,
      recipient_ref_type: 'agent_profile',
    });
    for (const row of rows) expect(row.payload).not.toMatch(/@|E2E Lead/);
  });

  it('writes no buyer row without email consent', async () => {
    const leadId = await seedLead(false);
    expect((await verify(leadId)).status).toBeLessThan(300);
    expect(await outboxOf(leadId)).toEqual([]);
  });

  it('rejects an outbox row with a bad state or a non-object payload', async () => {
    const leadId = await seedLead(true);
    const insert = (state: string, payload: string) =>
      pool().query(
        `INSERT INTO notification_outbox
           (lead_id, event_type, recipient_kind, channel, recipient_ref, recipient_ref_type,
            template_key, state, payload)
         VALUES ($1, 'lead.received', 'buyer', 'email', $1, 'lead', 'k', $2, $3::jsonb)`,
        [leadId, state, payload],
      );
    await expect(insert('pending', '{}')).rejects.toThrow(/state_check/);
    await expect(insert('held', '[]')).rejects.toThrow(/payload_check/);
  });
});
