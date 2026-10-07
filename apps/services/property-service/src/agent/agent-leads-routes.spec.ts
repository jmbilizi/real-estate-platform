import request from 'supertest';
import {
  AGENT_BUYER_AGREEMENT_REMINDER,
  FORBIDDEN_BODY,
  INVALID_TRANSITION_BODY,
  LEAD_NOT_FOUND_BODY,
  SIGN_IN_REQUIRED_BODY,
} from '@cribstop/property-contracts';
import { createApp } from '../app';
import type { IntrospectionClient, IntrospectionOutcome } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';
import { ROLE } from '../staff/roles';

const ACCOUNT = '0190a000-0000-7000-8000-00000000000c';
const PROFILE = '0190a000-0000-7000-8000-0000000000a1';
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

interface World {
  /** Active profile of the caller, or none. */
  profile: boolean;
  /** Does the caller hold the open assignment? */
  owned: boolean;
  status: string;
}

/** A fake database that answers by statement. `calls` records every statement in order. */
function fakePool(world: Partial<World> = {}) {
  const w: World = { profile: true, owned: true, status: 'assigned', ...world };
  const calls: Call[] = [];
  const run = (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM agent_profiles/.test(sql))
      return Promise.resolve({ rows: w.profile ? [{ id: PROFILE }] : [] });
    if (/SELECT 1 FROM lead_assignments/.test(sql))
      return Promise.resolve({ rows: w.owned ? [{}] : [] });
    if (/FROM lead_assignments a/.test(sql)) {
      return Promise.resolve({ rows: w.owned ? [leadRow(w.status)] : [] });
    }
    if (/SELECT status FROM listing_inquiries/.test(sql)) {
      return Promise.resolve({ rows: [{ status: w.status }] });
    }
    if (/RETURNING agent_profile_id/.test(sql)) {
      return Promise.resolve({ rows: [{ agent_profile_id: PROFILE }] });
    }
    return Promise.resolve({ rows: [] });
  };
  return {
    calls,
    query: run,
    connect: () => Promise.resolve({ query: run, release: () => undefined }),
  };
}

const leadRow = (status: string) => ({
  id: LEAD,
  created_at: NOW,
  assigned_at: NOW,
  accepted_at: status === 'assigned' ? null : NOW,
  kind: 'message',
  status,
  name: 'Jordan Buyer',
  email: 'jordan@example.com',
  phone: '202-555-0143',
  message: 'Is it still available?',
  consent_to_contact: true,
  consent_disclosure_text: 'Consent text',
  consent_channels: ['email'],
  consent_given_at: NOW,
  listing_id: '0190a000-0000-7000-8000-0000000000c1',
  listing_title: 'A home',
  listing_address: '1 Main St',
  listing_state: 'MD',
  listing_price: '500000',
  listing_status: 'Active',
});

const appWith = (outcome: IntrospectionOutcome, pool = fakePool()) =>
  createApp({ pool: pool as unknown as ReadPool, introspection: client(outcome) });

const sqlOf = (pool: ReturnType<typeof fakePool>) => pool.calls.map((c) => c.sql).join('\n');

describe('agent routes access', () => {
  it.each([
    ['GET', '/agent/leads'],
    ['GET', `/agent/leads/${LEAD}`],
    ['POST', `/agent/leads/${LEAD}/accept`],
    ['POST', `/agent/leads/${LEAD}/decline`],
    ['POST', `/agent/leads/${LEAD}/status`],
  ] as const)(
    '%s %s answers 401 signed out and 403 without the Agent role',
    async (method, path) => {
      const pool = fakePool();
      const call = (outcome: IntrospectionOutcome) =>
        request(appWith(outcome, pool))[method.toLowerCase() as 'get'](path).send({});
      const signedOut = await call({ kind: 'signed-out' });
      expect(signedOut.status).toBe(401);
      expect(signedOut.body).toEqual(SIGN_IN_REQUIRED_BODY);
      for (const held of [[ROLE.User], [ROLE.Moderator], [ROLE.Admin], [ROLE.SuperAdmin]]) {
        const res = await call(as(...held));
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN_BODY);
      }
      expect(pool.calls).toHaveLength(0);
    },
  );

  it('answers 403 for an Agent with no active profile, before any lead query', async () => {
    const pool = fakePool({ profile: false });
    const res = await request(appWith(as(ROLE.User, ROLE.Agent), pool)).get('/agent/leads');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN_BODY);
    expect(sqlOf(pool)).not.toMatch(/lead_assignments/);
  });

  it('keeps the agent view and the staff view on separate routes for a multi-role account', async () => {
    const pool = fakePool();
    const app = appWith(as(ROLE.User, ROLE.Agent, ROLE.Moderator), pool);
    expect((await request(app).get('/agent/leads')).status).toBe(200);
    // The staff list answers for the Moderator role and does not filter on the agent profile.
    pool.calls.length = 0;
    expect((await request(app).get('/staff/leads')).status).toBe(200);
    expect(sqlOf(pool)).not.toMatch(/lead_assignments/);
  });
});

describe('GET /agent/leads', () => {
  it('joins on the open assignment of the caller profile and masks contact', async () => {
    const pool = fakePool();
    const res = await request(appWith(as(ROLE.Agent), pool)).get('/agent/leads');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const list = pool.calls.find((c) => /FROM lead_assignments a/.test(c.sql));
    expect(list?.sql).toMatch(/a\.agent_profile_id = \$1 AND a\.ended_at IS NULL/);
    expect(list?.params).toEqual([PROFILE]);
    const row = res.body.results[0];
    expect(row.emailMasked).toBe('j***@example.com');
    expect(row.phoneMasked).toBe('***-***-0143');
    expect(JSON.stringify(res.body)).not.toMatch(/jordan|Jordan|555|Is it still/);
  });

  it('binds the status filter and rejects unknown parameters', async () => {
    const pool = fakePool();
    await request(appWith(as(ROLE.Agent), pool)).get('/agent/leads?status=accepted');
    expect(pool.calls.find((c) => /FROM lead_assignments a/.test(c.sql))?.params).toEqual([
      PROFILE,
      'accepted',
    ]);
    const bad = await request(appWith(as(ROLE.Agent))).get('/agent/leads?foo=1');
    expect(bad.status).toBe(400);
  });
});

describe('GET /agent/leads/:id', () => {
  it('masks the contact and hides the message before accept, and still audits the read', async () => {
    const pool = fakePool({ status: 'assigned' });
    const res = await request(appWith(as(ROLE.Agent), pool)).get(`/agent/leads/${LEAD}`);
    expect(res.status).toBe(200);
    expect(res.body.contact).toBeNull();
    expect(res.body.buyerAgreementReminder).toBe(AGENT_BUYER_AGREEMENT_REMINDER);
    expect(JSON.stringify(res.body)).not.toMatch(/Jordan|jordan@|555-0143|Is it still/);
    const audit = pool.calls.find((c) => /INSERT INTO lead_access_audit/.test(c.sql));
    expect(audit?.params).toEqual([LEAD, ACCOUNT, 'Agent']);
  });

  it.each(['accepted', 'contacted', 'touring'])('reveals the contact at %s', async (status) => {
    const pool = fakePool({ status });
    const res = await request(appWith(as(ROLE.Agent), pool)).get(`/agent/leads/${LEAD}`);
    expect(res.body.contact).toMatchObject({
      name: 'Jordan Buyer',
      email: 'jordan@example.com',
      phone: '202-555-0143',
      message: 'Is it still available?',
    });
    expect(pool.calls.some((c) => /INSERT INTO lead_access_audit/.test(c.sql))).toBe(true);
  });

  it('answers 404, not 403, for a lead that is not the caller, and writes no audit row', async () => {
    const pool = fakePool({ owned: false });
    const res = await request(appWith(as(ROLE.Agent), pool)).get(`/agent/leads/${LEAD}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(LEAD_NOT_FOUND_BODY);
    expect(sqlOf(pool)).not.toMatch(/lead_access_audit/);
  });

  it('answers the same 404 for a malformed id', async () => {
    const res = await request(appWith(as(ROLE.Agent))).get('/agent/leads/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(LEAD_NOT_FOUND_BODY);
  });
});

describe('agent status changes', () => {
  const post = (pool: ReturnType<typeof fakePool>, path: string, body: object = {}) =>
    request(appWith(as(ROLE.Agent), pool))
      .post(`/agent/leads/${LEAD}/${path}`)
      .send(body);
  const eventOf = (pool: ReturnType<typeof fakePool>) =>
    pool.calls.find((c) => /INSERT INTO lead_status_events/.test(c.sql));

  it('accepts: records the accept time and an event with the agent as actor', async () => {
    const pool = fakePool({ status: 'assigned' });
    const res = await post(pool, 'accept');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: LEAD, from: 'assigned', to: 'accepted' });
    expect(sqlOf(pool)).toMatch(/SET accepted_at = now\(\)/);
    expect(eventOf(pool)?.params).toEqual([
      LEAD,
      'assigned',
      'accepted',
      ACCOUNT,
      'Agent',
      null,
      PROFILE,
    ]);
  });

  it('declines: records the reason, ends the assignment as declined, returns to verified', async () => {
    const pool = fakePool({ status: 'assigned' });
    const res = await post(pool, 'decline', { reason: 'no_capacity' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: LEAD, from: 'assigned', to: 'verified' });
    expect(pool.calls.find((c) => /SET decline_reason/.test(c.sql))?.params).toEqual([
      LEAD,
      PROFILE,
      'no_capacity',
    ]);
    expect(
      pool.calls.find((c) => /SET ended_at = now\(\), end_reason = \$2/.test(c.sql))?.params,
    ).toEqual([LEAD, 'declined']);
    expect(eventOf(pool)?.params).toEqual([
      LEAD,
      'assigned',
      'verified',
      ACCOUNT,
      'Agent',
      'Declined: no_capacity',
      PROFILE,
    ]);
  });

  it.each([
    ['no reason', {}],
    ['a free-text reason', { reason: 'the buyer has kids' }],
    ['an extra field', { reason: 'other', note: 'x' }],
  ])('rejects a decline with %s', async (_name, body) => {
    const pool = fakePool();
    const res = await post(pool, 'decline', body);
    expect(res.status).toBe(400);
    expect(pool.calls.filter((c) => /UPDATE|INSERT/.test(c.sql))).toHaveLength(0);
  });

  it('refuses a decline after accept with 409', async () => {
    const pool = fakePool({ status: 'accepted' });
    const res = await post(pool, 'decline', { reason: 'other' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(INVALID_TRANSITION_BODY);
    expect(sqlOf(pool)).not.toMatch(/INSERT INTO lead_status_events/);
  });

  it('moves an accepted lead forward and writes the event', async () => {
    const pool = fakePool({ status: 'accepted' });
    const res = await post(pool, 'status', { to: 'contacted', note: 'Called the buyer.' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: LEAD, from: 'accepted', to: 'contacted' });
    expect(eventOf(pool)?.params).toEqual([
      LEAD,
      'accepted',
      'contacted',
      ACCOUNT,
      'Agent',
      'Called the buyer.',
      PROFILE,
    ]);
  });

  it('ends the assignment when the lead closes', async () => {
    const pool = fakePool({ status: 'under_contract' });
    const res = await post(pool, 'status', { to: 'closed' });
    expect(res.status).toBe(200);
    expect(pool.calls.find((c) => /end_reason = \$2/.test(c.sql))?.params).toEqual([
      LEAD,
      'closed',
    ]);
  });

  it.each([
    ['accepted', 'closed'],
    ['accepted', 'touring'],
    ['contacted', 'contacted'],
    ['touring', 'contacted'],
  ])('refuses %s to %s per the transitions table', async (from, to) => {
    const res = await post(fakePool({ status: from }), 'status', { to });
    expect(res.status).toBe(409);
  });

  it('refuses a status change before accept', async () => {
    const pool = fakePool({ status: 'assigned' });
    const res = await post(pool, 'status', { to: 'lost' });
    expect(res.status).toBe(409);
    expect(sqlOf(pool)).not.toMatch(/UPDATE listing_inquiries/);
  });

  it.each(['accepted', 'verified', 'spam', 'assigned', 'new'])(
    'rejects the target %s on the status route',
    async (to) => {
      const res = await post(fakePool({ status: 'accepted' }), 'status', { to });
      expect(res.status).toBe(400);
    },
  );

  it.each([
    ['accept', {}],
    ['decline', { reason: 'other' }],
    ['status', { to: 'contacted' }],
  ])('%s answers 404 for a lead of another agent, with no write', async (path, body) => {
    // Even from a status the transition would refuse, so a 409 never confirms the lead exists.
    const pool = fakePool({ owned: false, status: 'new' });
    const res = await post(pool, path, body);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(LEAD_NOT_FOUND_BODY);
    expect(pool.calls.filter((c) => /UPDATE|INSERT/.test(c.sql))).toHaveLength(0);
  });
});
