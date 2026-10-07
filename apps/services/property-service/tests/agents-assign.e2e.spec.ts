import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import {
  agentProfileSchema,
  FORBIDDEN_BODY,
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
 * The agent directory and manual assignment (#634) against a REAL service and REAL database.
 * Start the service with `ACCOUNT_SERVICE_INTROSPECT_URL` set to the stub this file starts. The
 * Agent-role check reaches the same stub, on `/account/{id}/roles`.
 *
 * The fixture listings sit in the state `ZZ`, so no real market is hard-coded here.
 */
const fixtures = complianceFixtureIds();
const listing = fixtures.sampleListingId;

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

async function seedLead(status = 'verified'): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO listing_inquiries (listing_id, kind, message, status, account_id)
     VALUES ($1, 'message', 'Hello (e2e)', $2, gen_random_uuid()) RETURNING id`,
    [listing, status],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  await pool().query(
    `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
     VALUES ($1, NULL, $2, 'system')`,
    [id, status],
  );
  return id;
}

/** Creates a profile through the staff endpoint. The account holds the Agent role in the stub. */
async function createAgent(licenceStates: string[], active = true) {
  const accountId = randomUUID();
  setAccountRoles(accountId, ['User', 'Agent']);
  const res = await axios.post(
    '/staff/agents',
    { accountId, displayName: 'E2E Agent', licenceNumber: 'E2E-1', licenceStates, active },
    asAdmin,
  );
  expect(res.status).toBe(201);
  return agentProfileSchema.parse(res.data);
}

const assign = (leadId: string, agentProfileId: string, config = asModerator) =>
  axios.post(`/staff/leads/${leadId}/assign`, { agentProfileId }, config);
const unassign = (leadId: string, config = asModerator) =>
  axios.post(`/staff/leads/${leadId}/unassign`, { note: 'Agent unavailable.' }, config);
const detail = async (leadId: string) =>
  staffLeadDetailSchema.parse((await axios.get(`/staff/leads/${leadId}`, asAdmin)).data);

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

describe('agent directory', () => {
  it('lets Admin create, edit and deactivate, and Moderator read', async () => {
    const agent = await createAgent(['ZZ']);
    expect(agent.brokerage).toBe('Real Broker, LLC');

    const edited = await axios.patch(
      `/staff/agents/${agent.id}`,
      { displayName: 'Renamed Agent', licenceStates: ['ZZ', 'YY'] },
      asAdmin,
    );
    expect(edited.status).toBe(200);
    expect(edited.data.licenceStates).toEqual(['ZZ', 'YY']);

    const read = await axios.get(`/staff/agents/${agent.id}`, asModerator);
    expect(read.status).toBe(200);
    expect(read.data.displayName).toBe('Renamed Agent');

    const deactivated = await axios.patch(`/staff/agents/${agent.id}`, { active: false }, asAdmin);
    expect(deactivated.data.active).toBe(false);

    const onlyActive = await axios.get('/staff/agents', {
      ...asModerator,
      params: { active: 'true' },
    });
    expect((onlyActive.data.results as { id: string }[]).some((a) => a.id === agent.id)).toBe(
      false,
    );
  });

  it('refuses writes from a Moderator and every call from a buyer', async () => {
    const body = {
      accountId: randomUUID(),
      displayName: 'X',
      licenceNumber: 'X',
      licenceStates: ['ZZ'],
    };
    expect((await axios.post('/staff/agents', body, asModerator)).status).toBe(403);
    const res = await axios.get('/staff/agents', asBuyer);
    expect(res.status).toBe(403);
    expect(res.data).toEqual(FORBIDDEN_BODY);
  });

  it('refuses an account without the Agent role and a second profile for one account', async () => {
    const accountId = randomUUID();
    setAccountRoles(accountId, ['User']);
    const body = { accountId, displayName: 'No Role', licenceNumber: 'N-1', licenceStates: ['ZZ'] };
    expect((await axios.post('/staff/agents', body, asAdmin)).status).toBe(409);

    const agent = await createAgent(['ZZ']);
    const again = await axios.post(
      '/staff/agents',
      { ...body, accountId: agent.accountId },
      asAdmin,
    );
    expect(again.status).toBe(409);
  });

  it('refuses reactivation once the account lost the Agent role', async () => {
    const agent = await createAgent(['ZZ'], false);
    setAccountRoles(agent.accountId, ['User']);
    const res = await axios.patch(`/staff/agents/${agent.id}`, { active: true }, asAdmin);
    expect(res.status).toBe(409);
  });
});

describe('assign and unassign', () => {
  it('assigns a verified lead and records the history', async () => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead();

    const res = await assign(lead, agent.id);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      id: lead,
      from: 'verified',
      to: 'assigned',
      agentProfileId: agent.id,
    });

    const d = await detail(lead);
    expect(d.status).toBe('assigned');
    expect(d.assignments).toHaveLength(1);
    expect(d.assignments[0]).toMatchObject({
      agentProfileId: agent.id,
      assignedByAccountId: moderator,
      endedAt: null,
      endReason: null,
    });
    const event = d.history[d.history.length - 1];
    expect(event).toMatchObject({
      fromStatus: 'verified',
      toStatus: 'assigned',
      actorAccountId: moderator,
      agentProfileId: agent.id,
    });
  });

  it('refuses an agent whose licence states miss the listing state, and writes nothing', async () => {
    const agent = await createAgent(['YY']);
    const lead = await seedLead();
    const res = await assign(lead, agent.id);
    expect(res.status).toBe(409);
    const d = await detail(lead);
    expect(d.status).toBe('verified');
    expect(d.assignments).toHaveLength(0);
  });

  it('refuses an inactive agent and an unknown agent', async () => {
    const inactive = await createAgent(['ZZ'], false);
    const lead = await seedLead();
    expect((await assign(lead, inactive.id)).status).toBe(409);
    expect((await assign(lead, randomUUID())).status).toBe(404);
  });

  it.each(['new', 'assigned'])('refuses a lead that is %s', async (status) => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead(status);
    expect((await assign(lead, agent.id)).status).toBe(409);
  });

  it('allows one open assignment per lead, enforced by the index', async () => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead();
    expect((await assign(lead, agent.id)).status).toBe(200);
    // A second open row cannot exist, even through a direct insert.
    await expect(
      pool().query(
        `INSERT INTO lead_assignments (lead_id, agent_profile_id, assigned_by_account_id)
         VALUES ($1, $2, $3)`,
        [lead, agent.id, admin],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('survives two concurrent assigns: one wins and one open row remains', async () => {
    const a = await createAgent(['ZZ']);
    const b = await createAgent(['ZZ']);
    const lead = await seedLead();
    const results = await Promise.all([assign(lead, a.id), assign(lead, b.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const open = await pool().query(
      'SELECT 1 FROM lead_assignments WHERE lead_id = $1 AND ended_at IS NULL',
      [lead],
    );
    expect(open.rows).toHaveLength(1);
  });

  it('unassigns, then reassigns; the history keeps both rows', async () => {
    const first = await createAgent(['ZZ']);
    const second = await createAgent(['ZZ']);
    const lead = await seedLead();
    await assign(lead, first.id);

    const out = await unassign(lead);
    expect(out.status).toBe(200);
    expect(out.data).toEqual({ id: lead, from: 'assigned', to: 'verified' });

    expect((await assign(lead, second.id)).status).toBe(200);

    const d = await detail(lead);
    expect(d.status).toBe('assigned');
    expect(d.assignments.map((a) => [a.agentProfileId, a.endReason])).toEqual([
      [first.id, 'unassigned'],
      [second.id, null],
    ]);
    const unassignEvent = d.history.find(
      (h) => h.toStatus === 'verified' && h.fromStatus === 'assigned',
    );
    expect(unassignEvent).toMatchObject({ agentProfileId: first.id, note: 'Agent unavailable.' });
  });

  it('ends the assignment when the generic transition returns the lead to verified', async () => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead();
    await assign(lead, agent.id);
    const res = await axios.post(
      `/staff/leads/${lead}/transition`,
      { to: 'verified' },
      asModerator,
    );
    expect(res.status).toBe(200);
    const d = await detail(lead);
    expect(d.assignments[0]?.endReason).toBe('returned');
  });

  it('requires a note to unassign, and refuses a lead with no open assignment', async () => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead();
    await assign(lead, agent.id);
    expect((await axios.post(`/staff/leads/${lead}/unassign`, {}, asModerator)).status).toBe(400);

    const fresh = await seedLead('new');
    expect((await unassign(fresh)).status).toBe(409);
    expect((await detail(fresh)).status).toBe('new');
  });

  it('refuses a free-text reason on assign', async () => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead();
    const res = await axios.post(
      `/staff/leads/${lead}/assign`,
      { agentProfileId: agent.id, reason: 'any text' },
      asModerator,
    );
    expect(res.status).toBe(400);
  });

  it('keeps assignment rows: a direct delete or an edit of a closed row fails', async () => {
    const agent = await createAgent(['ZZ']);
    const lead = await seedLead();
    await assign(lead, agent.id);
    await unassign(lead);
    await expect(
      pool().query('DELETE FROM lead_assignments WHERE lead_id = $1', [lead]),
    ).rejects.toMatchObject({ code: '23000' });
    await expect(
      pool().query("UPDATE lead_assignments SET end_reason = 'returned' WHERE lead_id = $1", [
        lead,
      ]),
    ).rejects.toMatchObject({ code: '23000' });
  });
});
