import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import {
  agentLeadDetailSchema,
  agentLeadsEnvelopeSchema,
  agentProfileSchema,
  FORBIDDEN_BODY,
  LEAD_NOT_FOUND_BODY,
  staffLeadDetailSchema,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';
import {
  bearerFor,
  introspectionStubUrl,
  setAccountRoles,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/**
 * The agent "My leads" API (#636) against a REAL service and REAL database. Start the service with
 * `ACCOUNT_SERVICE_INTROSPECT_URL` set to the stub this file starts. The fixture listings sit in
 * the state `ZZ`.
 */
const listing = complianceFixtureIds().sampleListingId;

const admin = randomUUID();
const moderator = randomUUID();
const asAdmin = { headers: bearerFor(admin, ['User', 'Admin']), validateStatus: () => true };
const asModerator = {
  headers: bearerFor(moderator, ['User', 'Moderator']),
  validateStatus: () => true,
};
const asBuyer = { headers: bearerFor(randomUUID(), ['User']), validateStatus: () => true };

let stub: Server;
const pool = () => getPool();

interface TestAgent {
  profileId: string;
  accountId: string;
  as: { headers: Record<string, string>; validateStatus: () => boolean };
}

async function createAgent(): Promise<TestAgent> {
  const accountId = randomUUID();
  setAccountRoles(accountId, ['User', 'Agent']);
  const res = await axios.post(
    '/staff/agents',
    {
      accountId,
      displayName: 'E2E Agent',
      licenceNumber: 'E2E-1',
      licenceStates: ['ZZ'],
    },
    asAdmin,
  );
  expect(res.status).toBe(201);
  const profile = agentProfileSchema.parse(res.data);
  return {
    profileId: profile.id,
    accountId,
    as: { headers: bearerFor(accountId, ['User', 'Agent']), validateStatus: () => true },
  };
}

/** A `verified` lead, assigned to the agent through the staff route. */
async function assignedLead(agent: TestAgent): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@e2e.example.com`;
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO listing_inquiries (listing_id, kind, name, email, phone, message, status)
     VALUES ($1, 'message', 'Jordan E2E', $2, '202-555-0143', 'Hello (e2e)', 'verified')
     RETURNING id`,
    [listing, email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  await pool().query(
    `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
     VALUES ($1, NULL, 'verified', 'system')`,
    [id],
  );
  const res = await axios.post(
    `/staff/leads/${id}/assign`,
    { agentProfileId: agent.profileId },
    asModerator,
  );
  expect(res.status).toBe(200);
  return { id, email };
}

const staffDetail = async (leadId: string) =>
  staffLeadDetailSchema.parse((await axios.get(`/staff/leads/${leadId}`, asAdmin)).data);
const auditCount = async (leadId: string, role: string) =>
  Number(
    (
      await pool().query<{ n: string }>(
        'SELECT count(*) AS n FROM lead_access_audit WHERE lead_id = $1 AND actor_role = $2',
        [leadId, role],
      )
    ).rows[0]?.n,
  );

beforeAll(async () => {
  stub = await startIntrospectionStub();
  const probe = await axios.get('/staff/agents', asAdmin);
  if (probe.status === 401 || probe.status === 403) {
    throw new Error(
      `The service rejected the staff e2e credential. Start it with ACCOUNT_SERVICE_INTROSPECT_URL=${introspectionStubUrl()}`,
    );
  }
});

afterAll(async () => {
  await stopIntrospectionStub(stub);
  await closePool();
});

describe('access', () => {
  it('refuses a buyer and an Agent with no active profile', async () => {
    const buyer = await axios.get('/agent/leads', asBuyer);
    expect(buyer.status).toBe(403);
    expect(buyer.data).toEqual(FORBIDDEN_BODY);

    const accountId = randomUUID();
    const noProfile = await axios.get('/agent/leads', {
      headers: bearerFor(accountId, ['User', 'Agent']),
      validateStatus: () => true,
    });
    expect(noProfile.status).toBe(403);

    const agent = await createAgent();
    await axios.patch(`/staff/agents/${agent.profileId}`, { active: false }, asAdmin);
    expect((await axios.get('/agent/leads', agent.as)).status).toBe(403);
  });
});

describe('isolation', () => {
  it('shows each agent only the leads assigned to that agent, and 404 for the rest', async () => {
    const a = await createAgent();
    const b = await createAgent();
    const leadA = await assignedLead(a);
    const leadB = await assignedLead(b);

    const listA = agentLeadsEnvelopeSchema.parse((await axios.get('/agent/leads', a.as)).data);
    const idsA = listA.results.map((r) => r.id);
    expect(idsA).toContain(leadA.id);
    expect(idsA).not.toContain(leadB.id);

    const other = await axios.get(`/agent/leads/${leadB.id}`, a.as);
    expect(other.status).toBe(404);
    expect(other.data).toEqual(LEAD_NOT_FOUND_BODY);
    for (const [path, body] of [
      ['accept', {}],
      ['decline', { reason: 'other' }],
      ['status', { to: 'contacted' }],
    ] as const) {
      const res = await axios.post(`/agent/leads/${leadB.id}/${path}`, body, a.as);
      expect(res.status).toBe(404);
    }
    expect((await staffDetail(leadB.id)).status).toBe('assigned');
    expect(await auditCount(leadB.id, 'Agent')).toBe(0);
  });
});

describe('the agent flow', () => {
  it('masks before accept, reveals after, audits each read, and logs each change', async () => {
    const agent = await createAgent();
    const lead = await assignedLead(agent);

    const before = agentLeadDetailSchema.parse(
      (await axios.get(`/agent/leads/${lead.id}`, agent.as)).data,
    );
    expect(before.contact).toBeNull();
    expect(JSON.stringify(before)).not.toContain(lead.email);
    expect(JSON.stringify(before)).not.toContain('Jordan');
    expect(JSON.stringify(before)).not.toContain('Hello (e2e)');
    expect(await auditCount(lead.id, 'Agent')).toBe(1);

    // A decline is not open to a status call before accept.
    expect(
      (await axios.post(`/agent/leads/${lead.id}/status`, { to: 'lost' }, agent.as)).status,
    ).toBe(409);

    const accept = await axios.post(`/agent/leads/${lead.id}/accept`, {}, agent.as);
    expect(accept.status).toBe(200);
    expect(accept.data).toMatchObject({ from: 'assigned', to: 'accepted' });
    expect((await axios.post(`/agent/leads/${lead.id}/accept`, {}, agent.as)).status).toBe(409);

    const after = agentLeadDetailSchema.parse(
      (await axios.get(`/agent/leads/${lead.id}`, agent.as)).data,
    );
    expect(after.contact).toMatchObject({ email: lead.email, name: 'Jordan E2E' });
    expect(after.acceptedAt).not.toBeNull();
    expect(await auditCount(lead.id, 'Agent')).toBe(2);

    // Accepted leads do not skip ahead.
    expect(
      (await axios.post(`/agent/leads/${lead.id}/status`, { to: 'closed' }, agent.as)).status,
    ).toBe(409);
    for (const to of ['contacted', 'touring', 'under_contract', 'closed']) {
      const res = await axios.post(`/agent/leads/${lead.id}/status`, { to }, agent.as);
      expect(res.status).toBe(200);
    }

    const history = (await staffDetail(lead.id)).history;
    const agentEvents = history.filter((h) => h.actorRole === 'Agent');
    expect(agentEvents.map((h) => h.toStatus)).toEqual([
      'accepted',
      'contacted',
      'touring',
      'under_contract',
      'closed',
    ]);
    expect(agentEvents.every((h) => h.actorAccountId === agent.accountId)).toBe(true);
    expect(agentEvents.every((h) => h.agentProfileId === agent.profileId)).toBe(true);

    // The assignment ended with the close, so the lead leaves the dashboard.
    expect((await axios.get(`/agent/leads/${lead.id}`, agent.as)).status).toBe(404);
  });

  it('declines: ends the assignment, returns the lead to verified, and allows a new assign', async () => {
    const agent = await createAgent();
    const next = await createAgent();
    const lead = await assignedLead(agent);

    expect(
      (await axios.post(`/agent/leads/${lead.id}/decline`, { reason: 'free text' }, agent.as))
        .status,
    ).toBe(400);
    const res = await axios.post(
      `/agent/leads/${lead.id}/decline`,
      { reason: 'no_capacity' },
      agent.as,
    );
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ from: 'assigned', to: 'verified' });

    const detail = await staffDetail(lead.id);
    expect(detail.status).toBe('verified');
    expect(detail.assignments[0]).toMatchObject({
      agentProfileId: agent.profileId,
      endReason: 'declined',
    });
    const event = detail.history.at(-1);
    expect(event).toMatchObject({
      actorRole: 'Agent',
      actorAccountId: agent.accountId,
      toStatus: 'verified',
      note: 'Declined: no_capacity',
    });
    const stored = await pool().query<{ decline_reason: string }>(
      'SELECT decline_reason FROM lead_assignments WHERE lead_id = $1',
      [lead.id],
    );
    expect(stored.rows[0]?.decline_reason).toBe('no_capacity');

    expect((await axios.get(`/agent/leads/${lead.id}`, agent.as)).status).toBe(404);
    const reassigned = await axios.post(
      `/staff/leads/${lead.id}/assign`,
      { agentProfileId: next.profileId },
      asModerator,
    );
    expect(reassigned.status).toBe(200);
  });

  it('refuses a decline after accept', async () => {
    const agent = await createAgent();
    const lead = await assignedLead(agent);
    await axios.post(`/agent/leads/${lead.id}/accept`, {}, agent.as);
    const res = await axios.post(`/agent/leads/${lead.id}/decline`, { reason: 'other' }, agent.as);
    expect(res.status).toBe(409);
  });
});

describe('a multi-role account', () => {
  it('uses the agent view on /agent and the staff view on /staff, each under its own role', async () => {
    const accountId = randomUUID();
    setAccountRoles(accountId, ['User', 'Agent', 'Moderator']);
    const created = await axios.post(
      '/staff/agents',
      { accountId, displayName: 'Dual', licenceNumber: 'D-1', licenceStates: ['ZZ'] },
      asAdmin,
    );
    expect(created.status).toBe(201);
    const dual = {
      headers: bearerFor(accountId, ['User', 'Agent', 'Moderator']),
      validateStatus: () => true,
    };
    const mine = await assignedLead({
      profileId: (created.data as { id: string }).id,
      accountId,
      as: dual,
    });
    const other = await assignedLead(await createAgent());

    const agentView = agentLeadsEnvelopeSchema.parse((await axios.get('/agent/leads', dual)).data);
    const agentIds = agentView.results.map((r) => r.id);
    expect(agentIds).toContain(mine.id);
    expect(agentIds).not.toContain(other.id);

    const staffView = await axios.get('/staff/leads', dual);
    expect(staffView.status).toBe(200);
    const staffIds = (staffView.data.results as { id: string }[]).map((r) => r.id);
    expect(staffIds).toContain(other.id);

    // Each detail read records the role of its own route.
    await axios.get(`/agent/leads/${mine.id}`, dual);
    await axios.get(`/staff/leads/${other.id}`, dual);
    expect(await auditCount(mine.id, 'Agent')).toBe(1);
    expect(await auditCount(other.id, 'Moderator')).toBe(1);
  });
});
