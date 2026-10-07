import request from 'supertest';
import {
  FORBIDDEN_BODY,
  INVALID_TRANSITION_BODY,
  SIGN_IN_REQUIRED_BODY,
} from '@cribstop/property-contracts';
import { createApp } from '../app';
import type { IntrospectionClient, IntrospectionOutcome } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';
import { decodeCursor, encodeCursor, maskEmail, maskPhone } from './leads-store';
import { ROLE } from './roles';

const ACCOUNT = '0190a000-0000-7000-8000-00000000000a';
const LEAD = '0190a000-0000-7000-8000-0000000000b1';

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

/** A pool that records every statement and answers from `answer`. */
function fakePool(answer: (call: Call) => unknown[] = () => []) {
  const calls: Call[] = [];
  const run = (sql: string, params: unknown[] = []) => {
    const call = { sql, params };
    calls.push(call);
    return Promise.resolve({ rows: answer(call) });
  };
  const pool = {
    calls,
    query: run,
    connect: () => Promise.resolve({ query: run, release: () => undefined }),
  };
  return pool;
}

const appWith = (outcome: IntrospectionOutcome, pool = fakePool()) =>
  createApp({ pool: pool as unknown as ReadPool, introspection: client(outcome) });

describe('masking', () => {
  it('keeps one character and the domain of an email', () => {
    expect(maskEmail('jane.doe@example.com')).toBe('j***@example.com');
    expect(maskEmail('no-at-sign')).toBe('***');
  });

  it('keeps only the last four digits of a phone', () => {
    expect(maskPhone('(202) 555-0187')).toBe('***-***-0187');
    expect(maskPhone('12')).toBe('***');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('cursor', () => {
  it('round-trips and rejects a cursor this service did not issue', () => {
    const cursor = { createdAt: '2026-10-06T10:00:00.123456Z', id: LEAD };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('["x","y"]').toString('base64url'))).toBeNull();
  });
});

describe.each([
  ['GET', '/staff/leads'],
  ['GET', `/staff/leads/${LEAD}`],
  ['POST', `/staff/leads/${LEAD}/transition`],
  ['POST', `/staff/leads/${LEAD}/notes`],
] as const)('%s %s access', (method, path) => {
  const call = (outcome: IntrospectionOutcome, pool = fakePool()) =>
    request(appWith(outcome, pool))[method.toLowerCase() as 'get' | 'post'](path).send({});

  it('answers 401 when signed out, before any query', async () => {
    const pool = fakePool();
    const res = await call({ kind: 'signed-out' }, pool);
    expect(res.status).toBe(401);
    expect(res.body).toEqual(SIGN_IN_REQUIRED_BODY);
    expect(pool.calls).toHaveLength(0);
  });

  it.each([[[ROLE.User]], [[ROLE.Agent]], [[ROLE.User, ROLE.Agent]], [[ROLE.Support]]])(
    'answers 403 for roles %j, before any query',
    async (roles) => {
      const pool = fakePool();
      const res = await call(as(...roles), pool);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN_BODY);
      expect(pool.calls).toHaveLength(0);
    },
  );
});

describe('GET /staff/leads', () => {
  it.each([[ROLE.Admin], [ROLE.SuperAdmin], [ROLE.Moderator]])(
    'allows %s, and a multi-role account that holds one of them',
    async (role) => {
      const alone = await request(appWith(as(role))).get('/staff/leads');
      expect(alone.status).toBe(200);
      expect(alone.headers['cache-control']).toContain('no-store');
      const multi = await request(appWith(as(ROLE.User, ROLE.Agent, role))).get('/staff/leads');
      expect(multi.status).toBe(200);
    },
  );

  it('masks contact fields and fetches one row more than the page size', async () => {
    const pool = fakePool(() => [
      {
        id: LEAD,
        created_at: new Date('2026-10-06T10:00:00.000Z'),
        created_at_cursor: '2026-10-06T10:00:00.000000Z',
        kind: 'message',
        status: 'new',
        name: 'Jane',
        email: 'jane@example.com',
        phone: '202-555-0187',
        verified_account: true,
        listing_id: LEAD,
        possible_duplicate: true,
      },
    ]);
    const res = await request(appWith(as(ROLE.Moderator), pool)).get('/staff/leads?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({
      emailMasked: 'j***@example.com',
      phoneMasked: '***-***-0187',
      possibleDuplicate: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('jane@example.com');
    expect(JSON.stringify(res.body)).not.toContain('555-0187');
    expect(res.body.nextCursor).toBeNull();
    expect(pool.calls[0]?.params.at(-1)).toBe(2);
  });

  it.each([
    ['limit=51'],
    ['limit=0'],
    ['limit=abc'],
    ['status=bogus'],
    ['kind=bogus'],
    ['listingId=nope'],
    ['createdFrom=yesterday'],
    ['createdFrom=2026-10-07T00:00:00Z&createdTo=2026-10-06T00:00:00Z'],
    ['cursor=garbage'],
    ['fields=email'],
    ['ethnicity=any'],
  ])('answers 400 for ?%s', async (query) => {
    const res = await request(appWith(as(ROLE.Admin))).get(`/staff/leads?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });
});

describe('GET /staff/leads/:id', () => {
  it('answers 404 for a malformed id and for an unknown id, and writes no audit row', async () => {
    const pool = fakePool();
    const bad = await request(appWith(as(ROLE.Admin), pool)).get('/staff/leads/not-an-id');
    const unknown = await request(appWith(as(ROLE.Admin), pool)).get(`/staff/leads/${LEAD}`);
    expect(bad.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(bad.body).toEqual(unknown.body);
    expect(pool.calls.some((c) => c.sql.includes('lead_access_audit'))).toBe(false);
  });

  it('writes the audit row with the acting role, before it reads history and notes', async () => {
    const pool = fakePool((call) =>
      call.sql.includes('FROM listing_inquiries i')
        ? [
            {
              id: LEAD,
              created_at: new Date('2026-10-06T10:00:00.000Z'),
              kind: 'message',
              status: 'new',
              name: 'Jane',
              email: 'jane@example.com',
              phone: null,
              message: 'Hello',
              verified_account: false,
              consent_to_contact: false,
              consent_text_version: null,
              consent_disclosure_text: null,
              consent_channels: null,
              consent_given_at: null,
              listing_id: LEAD,
              listing_title: 'A home',
              listing_address: '1 Main St',
              listing_state: 'MD',
              listing_price: '500000.00',
              listing_status: 'Active',
              possible_duplicate: false,
            },
          ]
        : [],
    );
    const res = await request(appWith(as(ROLE.User, ROLE.SuperAdmin), pool)).get(
      `/staff/leads/${LEAD}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('jane@example.com');
    expect(res.body.listing.listPrice).toBe(500000);
    expect(res.body.listing.state).toBe('MD');
    const audit = pool.calls.findIndex((c) => c.sql.includes('INSERT INTO lead_access_audit'));
    const history = pool.calls.findIndex((c) => c.sql.includes('FROM lead_status_events'));
    expect(audit).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(history);
    expect(pool.calls[audit]?.params).toEqual([LEAD, ACCOUNT, ROLE.SuperAdmin]);
  });

  it('sends no data when the audit insert fails', async () => {
    const pool = fakePool((call) => {
      if (call.sql.includes('INSERT INTO lead_access_audit')) throw new Error('audit down');
      return call.sql.includes('FROM listing_inquiries i')
        ? [{ id: LEAD, email: 'jane@example.com', created_at: new Date() }]
        : [];
    });
    const res = await request(appWith(as(ROLE.Admin), pool)).get(`/staff/leads/${LEAD}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('jane@example.com');
  });
});

describe('POST /staff/leads/:id/transition', () => {
  const statusClient = (status: string | null) =>
    fakePool((call) => (call.sql.includes('FOR UPDATE') && status ? [{ status }] : []));
  const post = (outcome: IntrospectionOutcome, pool: ReturnType<typeof fakePool>, body: unknown) =>
    request(appWith(outcome, pool))
      .post(`/staff/leads/${LEAD}/transition`)
      .send(body as object);

  it('moves a lead through changeLeadStatus and records the acting role', async () => {
    const pool = statusClient('new');
    const res = await post(as(ROLE.Moderator), pool, { to: 'verified' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: LEAD, from: 'new', to: 'verified' });
    const event = pool.calls.find((c) => c.sql.includes('INSERT INTO lead_status_events'));
    expect(event?.params).toEqual([LEAD, 'new', 'verified', ACCOUNT, ROLE.Moderator, null, null]);
  });

  it.each([['spam'], ['rejected']])('requires a note for %s', async (to) => {
    const pool = statusClient('new');
    const res = await post(as(ROLE.Moderator), pool, { to });
    expect(res.status).toBe(400);
    expect(pool.calls).toHaveLength(0);
    const ok = await post(as(ROLE.Moderator), statusClient('new'), { to, note: 'Bot traffic' });
    expect(ok.status).toBe(200);
  });

  it('answers 409 for a change the transitions table forbids', async () => {
    const res = await post(as(ROLE.Admin), statusClient('closed'), { to: 'verified' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual(INVALID_TRANSITION_BODY);
  });

  it('answers 409, not 200, for a verified lead moved to verified', async () => {
    const res = await post(as(ROLE.Admin), statusClient('verified'), { to: 'verified' });
    expect(res.status).toBe(409);
  });

  it('answers 404 for an unknown lead', async () => {
    const res = await post(as(ROLE.Admin), statusClient(null), { to: 'verified' });
    expect(res.status).toBe(404);
  });

  it.each([['assigned'], ['contacted'], ['closed'], ['new']])(
    'answers 403 when a Moderator asks for %s',
    async (to) => {
      const res = await post(as(ROLE.Moderator), statusClient('spam'), { to });
      expect(res.status).toBe(403);
    },
  );

  it('lets an Admin restore a spam lead to new', async () => {
    const res = await post(as(ROLE.Admin), statusClient('spam'), { to: 'new' });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown status and an unknown field', async () => {
    expect((await post(as(ROLE.Admin), statusClient('new'), { to: 'bogus' })).status).toBe(400);
    expect(
      (await post(as(ROLE.Admin), statusClient('new'), { to: 'verified', actorRole: 'Admin' }))
        .status,
    ).toBe(400);
  });
});

describe('POST /staff/leads/:id/notes', () => {
  const post = (pool: ReturnType<typeof fakePool>, body: unknown) =>
    request(appWith(as(ROLE.Moderator), pool))
      .post(`/staff/leads/${LEAD}/notes`)
      .send(body as object);

  it('appends a note with author and role', async () => {
    const pool = fakePool(() => [
      {
        id: LEAD,
        author_account_id: ACCOUNT,
        author_role: ROLE.Moderator,
        body: 'Called back',
        created_at: new Date('2026-10-06T10:00:00.000Z'),
      },
    ]);
    const res = await post(pool, { body: 'Called back' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ authorAccountId: ACCOUNT, authorRole: ROLE.Moderator });
    expect(pool.calls[0]?.params).toEqual([LEAD, ACCOUNT, ROLE.Moderator, 'Called back']);
  });

  it('answers 404 when no lead matched', async () => {
    expect((await post(fakePool(), { body: 'x' })).status).toBe(404);
  });

  it.each([[{}], [{ body: '   ' }], [{ body: 'x'.repeat(2001) }], [{ body: 'x', author: 'me' }]])(
    'answers 400 for %j',
    async (body) => {
      expect((await post(fakePool(), body)).status).toBe(400);
    },
  );
});
