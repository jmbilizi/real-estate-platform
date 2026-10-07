import request from 'supertest';
import {
  AGENT_BROKERAGE,
  AGENT_EXISTS_BODY,
  AGENT_INACTIVE_BODY,
  AGENT_NOT_FOUND_BODY,
  AGENT_NOT_LICENSED_BODY,
  AGENT_ROLE_REQUIRED_BODY,
  FORBIDDEN_BODY,
  INVALID_TRANSITION_BODY,
  LEAD_NOT_ASSIGNED_BODY,
  SIGN_IN_REQUIRED_BODY,
  staffLeadAssignRequestSchema,
} from '@cribstop/property-contracts';
import { createApp } from '../app';
import type { IntrospectionClient, IntrospectionOutcome } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';
import type { AgentRoleChecker, AgentRoleOutcome } from './agent-role-check';
import { ROLE } from './roles';

const ACCOUNT = '0190a000-0000-7000-8000-00000000000a';
const AGENT_ACCOUNT = '0190a000-0000-7000-8000-00000000000c';
const AGENT = '0190a000-0000-7000-8000-0000000000a1';
const LEAD = '0190a000-0000-7000-8000-0000000000b1';
const NOW = new Date('2026-10-07T12:00:00.000Z');

const as = (...roles: string[]): IntrospectionOutcome => ({
  kind: 'account',
  accountId: ACCOUNT,
  roles,
});

const client = (outcome: IntrospectionOutcome): IntrospectionClient => ({
  resolveAccountId: () => Promise.resolve(null),
  introspect: () => Promise.resolve(outcome),
});

interface Call {
  sql: string;
  params: unknown[];
}

function fakePool(answer: (call: Call) => unknown[] = () => []) {
  const calls: Call[] = [];
  const run = (sql: string, params: unknown[] = []) => {
    const call = { sql, params };
    calls.push(call);
    return Promise.resolve({ rows: answer(call) });
  };
  return {
    calls,
    query: run,
    connect: () => Promise.resolve({ query: run, release: () => undefined }),
  };
}

const roles = (outcome: AgentRoleOutcome): AgentRoleChecker => ({
  check: () => Promise.resolve(outcome),
});

const agentRow = (over: Record<string, unknown> = {}) => ({
  id: AGENT,
  account_id: AGENT_ACCOUNT,
  display_name: 'Test Agent',
  licence_number: 'LIC-1',
  licence_states: ['MD', 'DC'],
  active: true,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

const appWith = (
  outcome: IntrospectionOutcome,
  pool = fakePool(),
  agentRoles: AgentRoleChecker = roles('has-role'),
) => createApp({ pool: pool as unknown as ReadPool, introspection: client(outcome), agentRoles });

const createBody = {
  accountId: AGENT_ACCOUNT,
  displayName: 'Test Agent',
  licenceNumber: 'LIC-1',
  licenceStates: ['MD', 'DC'],
};

describe('agent directory access', () => {
  it.each([
    ['GET', '/staff/agents'],
    ['GET', `/staff/agents/${AGENT}`],
    ['POST', '/staff/agents'],
    ['PATCH', `/staff/agents/${AGENT}`],
    ['POST', `/staff/leads/${LEAD}/assign`],
    ['POST', `/staff/leads/${LEAD}/unassign`],
  ] as const)('%s %s answers 401 signed out and 403 for a buyer or agent', async (method, path) => {
    const call = (outcome: IntrospectionOutcome, pool = fakePool()) =>
      request(appWith(outcome, pool))[method.toLowerCase() as 'get'](path).send({});
    const pool = fakePool();
    const signedOut = await call({ kind: 'signed-out' }, pool);
    expect(signedOut.status).toBe(401);
    expect(signedOut.body).toEqual(SIGN_IN_REQUIRED_BODY);
    for (const held of [[ROLE.User], [ROLE.Agent], [ROLE.Support]]) {
      const res = await call(as(...held), pool);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN_BODY);
    }
    expect(pool.calls).toHaveLength(0);
  });

  it.each([
    ['POST', '/staff/agents'],
    ['PATCH', `/staff/agents/${AGENT}`],
  ] as const)(
    '%s %s refuses a Moderator: the directory is read-only for it',
    async (method, path) => {
      const pool = fakePool();
      const res = await request(appWith(as(ROLE.Moderator), pool))
        [method.toLowerCase() as 'post'](path)
        .send(createBody);
      expect(res.status).toBe(403);
      expect(pool.calls).toHaveLength(0);
    },
  );

  it.each([[ROLE.Moderator], [ROLE.Admin], [ROLE.SuperAdmin]])(
    '%s reads the directory',
    async (role) => {
      const pool = fakePool(() => [agentRow()]);
      const res = await request(appWith(as(role), pool)).get('/staff/agents');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(res.body.results).toEqual([
        {
          id: AGENT,
          accountId: AGENT_ACCOUNT,
          displayName: 'Test Agent',
          licenceNumber: 'LIC-1',
          licenceStates: ['MD', 'DC'],
          brokerage: AGENT_BROKERAGE,
          active: true,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      ]);
    },
  );
});

describe('GET /staff/agents', () => {
  it('filters by active flag and licence state with bound parameters', async () => {
    const pool = fakePool();
    await request(appWith(as(ROLE.Admin), pool)).get('/staff/agents?active=true&licenceState=VA');
    expect(pool.calls[0]?.params).toEqual([true, 'VA']);
    expect(pool.calls[0]?.sql).not.toMatch(/VA/);
  });

  it('rejects an unknown parameter and a lower-case state', async () => {
    for (const query of ['?foo=1', '?licenceState=md', '?active=maybe']) {
      const res = await request(appWith(as(ROLE.Admin))).get(`/staff/agents${query}`);
      expect(res.status).toBe(400);
    }
  });

  it('answers 404 for an unknown agent and a malformed id alike', async () => {
    const a = await request(appWith(as(ROLE.Admin))).get(`/staff/agents/${AGENT}`);
    const b = await request(appWith(as(ROLE.Admin))).get('/staff/agents/not-a-uuid');
    expect(a.status).toBe(404);
    expect(a.body).toEqual(AGENT_NOT_FOUND_BODY);
    expect(b.body).toEqual(AGENT_NOT_FOUND_BODY);
  });
});

describe('POST /staff/agents', () => {
  it('creates the profile after the Agent role check', async () => {
    const pool = fakePool(() => [agentRow()]);
    const res = await request(appWith(as(ROLE.SuperAdmin), pool))
      .post('/staff/agents')
      .send(createBody);
    expect(res.status).toBe(201);
    expect(res.body.accountId).toBe(AGENT_ACCOUNT);
    expect(pool.calls[0]?.params).toEqual([
      AGENT_ACCOUNT,
      'Test Agent',
      'LIC-1',
      ['MD', 'DC'],
      true,
    ]);
  });

  it('refuses an account without the Agent role, before any write', async () => {
    const pool = fakePool();
    const res = await request(appWith(as(ROLE.Admin), pool, roles('no-role')))
      .post('/staff/agents')
      .send(createBody);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(AGENT_ROLE_REQUIRED_BODY);
    expect(pool.calls).toHaveLength(0);
  });

  it('answers 503 when account-service does not answer', async () => {
    const res = await request(appWith(as(ROLE.Admin), fakePool(), roles('unavailable')))
      .post('/staff/agents')
      .send(createBody);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
  });

  it('answers 409 when the account already has a profile', async () => {
    const pool = fakePool();
    pool.query = () => Promise.reject(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await request(appWith(as(ROLE.Admin), pool))
      .post('/staff/agents')
      .send(createBody);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(AGENT_EXISTS_BODY);
  });

  it.each([
    ['an unknown field', { ...createBody, brokerage: 'Other LLC' }],
    ['no licence state', { ...createBody, licenceStates: [] }],
    ['a repeated state', { ...createBody, licenceStates: ['MD', 'MD'] }],
    ['a lower-case state', { ...createBody, licenceStates: ['md'] }],
    ['a blank name', { ...createBody, displayName: '  ' }],
    ['a bad account id', { ...createBody, accountId: 'nope' }],
  ])('rejects %s with 400', async (_name, body) => {
    const pool = fakePool();
    const res = await request(appWith(as(ROLE.Admin), pool))
      .post('/staff/agents')
      .send(body);
    expect(res.status).toBe(400);
    expect(pool.calls).toHaveLength(0);
  });
});

describe('PATCH /staff/agents/:id', () => {
  const patch = (
    outcome: IntrospectionOutcome,
    body: unknown,
    pool: ReturnType<typeof fakePool>,
    r = roles('has-role'),
  ) =>
    request(appWith(outcome, pool, r))
      .patch(`/staff/agents/${AGENT}`)
      .send(body as object);

  it('deactivates without a role check', async () => {
    const pool = fakePool(() => [agentRow({ active: false })]);
    const res = await patch(as(ROLE.Admin), { active: false }, pool, roles('no-role'));
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('checks the Agent role again on reactivation', async () => {
    const pool = fakePool(() => [agentRow({ active: false })]);
    const res = await patch(as(ROLE.Admin), { active: true }, pool, roles('no-role'));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(AGENT_ROLE_REQUIRED_BODY);
    expect(pool.calls.some((c) => /UPDATE agent_profiles/.test(c.sql))).toBe(false);
  });

  it('rejects the account id and an empty body', async () => {
    const pool = fakePool(() => [agentRow()]);
    expect((await patch(as(ROLE.Admin), { accountId: AGENT_ACCOUNT }, pool)).status).toBe(400);
    expect((await patch(as(ROLE.Admin), {}, pool)).status).toBe(400);
  });

  it('answers 404 for an unknown agent', async () => {
    const res = await patch(as(ROLE.Admin), { displayName: 'X' }, fakePool());
    expect(res.status).toBe(404);
  });
});

describe('POST /staff/leads/:id/assign', () => {
  /** Answers each statement the assign transaction runs. */
  const assignPool = (opts: {
    status?: string;
    agent?: Record<string, unknown> | null;
    state?: string;
  }) =>
    fakePool(({ sql }) => {
      if (/FOR UPDATE/.test(sql)) return [{ status: opts.status ?? 'verified' }];
      if (/FROM agent_profiles/.test(sql)) {
        return opts.agent === null
          ? []
          : [{ active: true, licence_states: ['MD', 'DC'], ...opts.agent }];
      }
      if (/FROM listing_inquiries i/.test(sql)) return [{ state: opts.state ?? 'MD' }];
      return [];
    });

  const assign = (pool: ReturnType<typeof fakePool>, role: string = ROLE.Moderator) =>
    request(appWith(as(role), pool))
      .post(`/staff/leads/${LEAD}/assign`)
      .send({ agentProfileId: AGENT });

  it.each([[ROLE.Moderator], [ROLE.Admin], [ROLE.SuperAdmin]])(
    '%s assigns a verified lead to a licensed, active agent',
    async (role) => {
      const pool = assignPool({});
      const res = await assign(pool, role);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: LEAD,
        from: 'verified',
        to: 'assigned',
        agentProfileId: AGENT,
      });
      const sql = pool.calls.map((c) => c.sql);
      expect(sql.some((s) => /INSERT INTO lead_assignments/.test(s))).toBe(true);
      const event = pool.calls.find((c) => /INSERT INTO lead_status_events/.test(c.sql));
      expect(event?.params).toEqual([LEAD, 'verified', 'assigned', ACCOUNT, role, null, AGENT]);
      expect(sql[sql.length - 1]).toBe('COMMIT');
    },
  );

  it('refuses an agent not licensed in the listing state, and writes nothing', async () => {
    const pool = assignPool({ state: 'VA' });
    const res = await assign(pool);
    expect(res.status).toBe(409);
    expect(res.body).toEqual(AGENT_NOT_LICENSED_BODY);
    const sql = pool.calls.map((c) => c.sql);
    expect(sql).toContain('ROLLBACK');
    expect(sql.some((s) => /INSERT INTO/.test(s))).toBe(false);
  });

  it('refuses an inactive agent', async () => {
    const res = await assign(assignPool({ agent: { active: false } }));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(AGENT_INACTIVE_BODY);
  });

  it('answers 404 for an unknown agent', async () => {
    const res = await assign(assignPool({ agent: null }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(AGENT_NOT_FOUND_BODY);
  });

  it.each([['new'], ['assigned'], ['accepted'], ['closed']])(
    'refuses a lead that is %s: only verified leads are assigned',
    async (status) => {
      const res = await assign(assignPool({ status }));
      expect(res.status).toBe(409);
      expect(res.body).toEqual(INVALID_TRANSITION_BODY);
    },
  );

  it('takes one field and no free text', async () => {
    expect(Object.keys(staffLeadAssignRequestSchema.shape)).toEqual(['agentProfileId']);
    const pool = assignPool({});
    for (const body of [
      { agentProfileId: AGENT, reason: 'prefers a family' },
      { agentProfileId: AGENT, note: 'x' },
      {},
      { agentProfileId: 'nope' },
    ]) {
      const res = await request(appWith(as(ROLE.Admin), pool))
        .post(`/staff/leads/${LEAD}/assign`)
        .send(body);
      expect(res.status).toBe(400);
    }
    expect(pool.calls).toHaveLength(0);
  });
});

describe('POST /staff/leads/:id/unassign', () => {
  const unassignPool = (status: string, open: boolean) =>
    fakePool(({ sql }) => {
      if (/FOR UPDATE/.test(sql)) return [{ status }];
      if (/^SELECT 1 FROM lead_assignments/.test(sql)) return open ? [{}] : [];
      if (/UPDATE lead_assignments/.test(sql)) return [{ agent_profile_id: AGENT }];
      return [];
    });

  const unassign = (
    pool: ReturnType<typeof fakePool>,
    body: object = { note: 'Agent unavailable.' },
  ) =>
    request(appWith(as(ROLE.Moderator), pool))
      .post(`/staff/leads/${LEAD}/unassign`)
      .send(body);

  it('ends the open assignment and returns the lead to verified', async () => {
    const pool = unassignPool('assigned', true);
    const res = await unassign(pool);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: LEAD, from: 'assigned', to: 'verified' });
    const end = pool.calls.find((c) => /UPDATE lead_assignments/.test(c.sql));
    expect(end?.params).toEqual([LEAD, 'unassigned']);
    const event = pool.calls.find((c) => /INSERT INTO lead_status_events/.test(c.sql));
    expect(event?.params).toEqual([
      LEAD,
      'assigned',
      'verified',
      ACCOUNT,
      ROLE.Moderator,
      'Agent unavailable.',
      AGENT,
    ]);
  });

  it('requires a note', async () => {
    const pool = unassignPool('assigned', true);
    expect((await unassign(pool, {})).status).toBe(400);
    expect((await unassign(pool, { note: '  ' })).status).toBe(400);
    expect(pool.calls).toHaveLength(0);
  });

  it('refuses a lead with no open assignment, so it cannot verify a new lead', async () => {
    const res = await unassign(unassignPool('new', false));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(LEAD_NOT_ASSIGNED_BODY);
  });

  it('refuses a lead the table cannot return to verified', async () => {
    const res = await unassign(unassignPool('contacted', true));
    expect(res.status).toBe(409);
    expect(res.body).toEqual(INVALID_TRANSITION_BODY);
  });
});
