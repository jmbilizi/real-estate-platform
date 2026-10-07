import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import {
  FORBIDDEN_BODY,
  INVALID_TRANSITION_BODY,
  staffLeadDetailSchema,
  staffLeadsEnvelopeSchema,
  UNAUTHENTICATED_BODY,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';
import {
  bearerFor,
  introspectionStubUrl,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/**
 * The staff lead desk (#632) against a REAL service and REAL database.
 *
 * Start the service with `ACCOUNT_SERVICE_INTROSPECT_URL` set to the stub this file starts. The
 * stub carries roles after a `|` in the bearer token. See tests/support/introspection-stub.ts.
 */
const fixtures = complianceFixtureIds();
const listingA = fixtures.sampleListingId;
const listingB = fixtures.suppressedAddressListingId;

const admin = randomUUID();
const moderator = randomUUID();
const asAdmin = { headers: bearerFor(admin, ['User', 'Admin']), validateStatus: () => true };
const asModerator = {
  headers: bearerFor(moderator, ['User', 'Agent', 'Moderator']),
  validateStatus: () => true,
};
const asSuperAdmin = {
  headers: bearerFor(randomUUID(), ['SuperAdmin']),
  validateStatus: () => true,
};
const asBuyer = { headers: bearerFor(randomUUID(), ['User']), validateStatus: () => true };
const asAgent = { headers: bearerFor(randomUUID(), ['User', 'Agent']), validateStatus: () => true };
const anonymous = { validateStatus: () => true };

let stub: Server;
const pool = () => getPool();

interface LeadSeed {
  listingId?: string;
  kind?: 'message' | 'tour_request';
  status?: string;
  email?: string;
  phone?: string | null;
  createdAt?: string;
}

/** A test-only insert, so a spec controls `created_at` and `status`. */
async function seedLead(seed: LeadSeed = {}): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO listing_inquiries
       (listing_id, kind, name, email, phone, message, status, created_at)
     VALUES ($1, $2, 'E2E Lead', $3, $4, 'Hello (e2e)', $5, COALESCE($6::timestamptz, now()))
     RETURNING id`,
    [
      seed.listingId ?? listingA,
      seed.kind ?? 'message',
      seed.email ?? `${randomUUID()}@e2e.example.com`,
      seed.phone ?? null,
      seed.status ?? 'new',
      seed.createdAt ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  await pool().query(
    `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
     VALUES ($1, NULL, $2, 'system')`,
    [id, seed.status ?? 'new'],
  );
  return id;
}

/** A window no other suite writes to, so list assertions stay exact. */
const window = (year: number) => ({
  createdFrom: `${year}-01-01T00:00:00Z`,
  createdTo: `${year + 1}-01-01T00:00:00Z`,
});
const at = (year: number, day: number) =>
  `${year}-03-${String(day).padStart(2, '0')}T12:00:00.000000Z`;

async function list(query: Record<string, string>, config = asAdmin) {
  return axios.get('/staff/leads', { ...config, params: query });
}

beforeAll(async () => {
  stub = await startIntrospectionStub();
  const probe = await axios.get('/staff/leads', asAdmin);
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
  const routes: [string, string][] = [
    ['get', '/staff/leads'],
    ['get', `/staff/leads/${randomUUID()}`],
    ['post', `/staff/leads/${randomUUID()}/transition`],
    ['post', `/staff/leads/${randomUUID()}/notes`],
  ];

  it.each(routes)('%s %s answers 401 when signed out', async (method, path) => {
    const res = await axios.request({ method, url: path, data: {}, ...anonymous });
    expect(res.status).toBe(401);
    expect(res.data.error.code).toBe(UNAUTHENTICATED_BODY.error.code);
  });

  it.each(routes)('%s %s answers 403 for a buyer and for an Agent', async (method, path) => {
    for (const config of [asBuyer, asAgent]) {
      const res = await axios.request({ method, url: path, data: {}, ...config });
      expect(res.status).toBe(403);
      expect(res.data).toEqual(FORBIDDEN_BODY);
    }
  });

  it('allows Admin, SuperAdmin, and a multi-role Moderator', async () => {
    for (const config of [asAdmin, asSuperAdmin, asModerator]) {
      const res = await list({ ...window(2090) }, config);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
    }
  });
});

describe('GET /staff/leads', () => {
  it('masks email and phone and never carries a full value', async () => {
    const id = await seedLead({
      email: 'jane.masked@e2e.example.com',
      phone: '(202) 555-0187',
      createdAt: at(2091, 1),
    });
    const res = await list(window(2091));
    const body = staffLeadsEnvelopeSchema.parse(res.data);
    const row = body.results.find((r) => r.id === id);
    expect(row).toMatchObject({ emailMasked: 'j***@e2e.example.com', phoneMasked: '***-***-0187' });
    const wire = JSON.stringify(res.data);
    expect(wire).not.toContain('jane.masked');
    expect(wire).not.toContain('555-0187');
    expect(wire).not.toContain('Hello (e2e)');
  });

  it('pages newest first with a bounded page size and no overlap', async () => {
    const ids: string[] = [];
    for (let day = 1; day <= 5; day += 1) {
      ids.push(await seedLead({ createdAt: at(2092, day) }));
    }
    const newestFirst = [...ids].reverse();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await list({ ...window(2092), limit: '2', ...(cursor ? { cursor } : {}) });
      const body = staffLeadsEnvelopeSchema.parse(res.data);
      expect(body.results.length).toBeLessThanOrEqual(2);
      seen.push(...body.results.map((r) => r.id));
      cursor = body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    expect(seen).toEqual(newestFirst);
    expect(pages).toBe(3);
  });

  it('keeps rows that share one timestamp across pages', async () => {
    const same = at(2093, 1);
    const ids = [
      await seedLead({ createdAt: same }),
      await seedLead({ createdAt: same }),
      await seedLead({ createdAt: same }),
    ];
    const first = staffLeadsEnvelopeSchema.parse(
      (await list({ ...window(2093), limit: '2' })).data,
    );
    const second = staffLeadsEnvelopeSchema.parse(
      (await list({ ...window(2093), limit: '2', cursor: first.nextCursor ?? '' })).data,
    );
    expect([...first.results, ...second.results].map((r) => r.id).sort()).toEqual([...ids].sort());
    expect(second.nextCursor).toBeNull();
  });

  it('rejects a page size over the cap and an unknown parameter', async () => {
    expect((await list({ limit: '51' })).status).toBe(400);
    expect((await list({ limit: '50' })).status).toBe(200);
    expect((await list({ fields: 'email' })).status).toBe(400);
  });

  it('filters by status, kind, listing and date range', async () => {
    const win = window(2094);
    const a = await seedLead({ createdAt: at(2094, 1), kind: 'message', status: 'new' });
    const b = await seedLead({ createdAt: at(2094, 2), kind: 'tour_request', status: 'verified' });
    const c = await seedLead({ createdAt: at(2094, 3), kind: 'message', listingId: listingB });
    const idsOf = async (q: Record<string, string>) =>
      staffLeadsEnvelopeSchema
        .parse((await list({ ...win, ...q })).data)
        .results.map((r) => r.id)
        .sort();

    expect(await idsOf({})).toEqual([a, b, c].sort());
    expect(await idsOf({ status: 'verified' })).toEqual([b]);
    expect(await idsOf({ kind: 'tour_request' })).toEqual([b]);
    expect(await idsOf({ listingId: listingB })).toEqual([c]);
    expect(
      await idsOf({ createdFrom: '2094-03-02T00:00:00Z', createdTo: '2094-03-03T00:00:00Z' }),
    ).toEqual([b]);
  });

  describe('possibleDuplicate', () => {
    const flagOf = async (year: number, id: string) =>
      staffLeadsEnvelopeSchema
        .parse((await list(window(year))).data)
        .results.find((r) => r.id === id)?.possibleDuplicate;

    it('flags the same email on the same listing within seven days, and merges nothing', async () => {
      const email = `Dup.${randomUUID()}@E2E.example.com`;
      const first = await seedLead({ email, createdAt: at(2095, 1) });
      const second = await seedLead({ email: email.toLowerCase(), createdAt: at(2095, 5) });
      expect(await flagOf(2095, first)).toBe(true);
      expect(await flagOf(2095, second)).toBe(true);
      const all = staffLeadsEnvelopeSchema.parse((await list(window(2095))).data);
      expect(all.results.map((r) => r.id).sort()).toEqual([first, second].sort());
    });

    it('flags the same phone written two ways', async () => {
      const first = await seedLead({ phone: '(202) 555-0111', createdAt: at(2096, 1) });
      const second = await seedLead({ phone: '+1 202.555.0111', createdAt: at(2096, 2) });
      expect(await flagOf(2096, first)).toBe(true);
      expect(await flagOf(2096, second)).toBe(true);
    });

    it('does not flag past the window, on another listing, or against a closed request', async () => {
      const email = `${randomUUID()}@e2e.example.com`;
      const early = await seedLead({ email, createdAt: at(2097, 1) });
      const late = await seedLead({ email, createdAt: at(2097, 10) });
      const elsewhere = await seedLead({ email, createdAt: at(2097, 11), listingId: listingB });
      expect(await flagOf(2097, early)).toBe(false);
      expect(await flagOf(2097, late)).toBe(false);
      expect(await flagOf(2097, elsewhere)).toBe(false);

      const mail2 = `${randomUUID()}@e2e.example.com`;
      const spam = await seedLead({ email: mail2, status: 'spam', createdAt: at(2098, 1) });
      const live = await seedLead({ email: mail2, createdAt: at(2098, 2) });
      expect(await flagOf(2098, live)).toBe(false);
      expect(await flagOf(2098, spam)).toBe(true);
    });
  });
});

describe('GET /staff/leads/:id', () => {
  it('returns the full lead, writes one audit row per read, and shows the history', async () => {
    const id = await seedLead({
      email: 'full.detail@e2e.example.com',
      phone: '202-555-0199',
      createdAt: at(2099, 1),
    });
    const before = await pool().query('SELECT 1 FROM lead_access_audit WHERE lead_id = $1', [id]);
    expect(before.rows).toHaveLength(0);

    const res = await axios.get(`/staff/leads/${id}`, asModerator);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const detail = staffLeadDetailSchema.parse(res.data);
    expect(detail).toMatchObject({
      email: 'full.detail@e2e.example.com',
      phone: '202-555-0199',
      message: 'Hello (e2e)',
      status: 'new',
      verifiedAccount: false,
      possibleDuplicate: false,
      listing: { id: listingA },
    });
    expect(detail.history).toHaveLength(1);

    await axios.get(`/staff/leads/${id}`, asAdmin);
    const audit = await pool().query<{ actor_account_id: string; actor_role: string }>(
      'SELECT actor_account_id, actor_role FROM lead_access_audit WHERE lead_id = $1 ORDER BY created_at',
      [id],
    );
    expect(audit.rows).toEqual([
      { actor_account_id: moderator, actor_role: 'Moderator' },
      { actor_account_id: admin, actor_role: 'Admin' },
    ]);
  });

  it('lists the ids of a duplicate on the detail', async () => {
    const email = `${randomUUID()}@e2e.example.com`;
    const first = await seedLead({ email, createdAt: at(2089, 1) });
    const second = await seedLead({ email, createdAt: at(2089, 2) });
    const detail = staffLeadDetailSchema.parse(
      (await axios.get(`/staff/leads/${second}`, asAdmin)).data,
    );
    expect(detail.possibleDuplicate).toBe(true);
    expect(detail.duplicateLeadIds).toEqual([first]);
  });

  it('answers 404 for an unknown id and writes no audit row', async () => {
    const unknown = randomUUID();
    expect((await axios.get(`/staff/leads/${unknown}`, asAdmin)).status).toBe(404);
    expect((await axios.get('/staff/leads/not-an-id', asAdmin)).status).toBe(404);
    const rows = await pool().query('SELECT 1 FROM lead_access_audit WHERE lead_id = $1', [
      unknown,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('keeps lead data out of the public listing response', async () => {
    const email = `public.leak.${randomUUID()}@e2e.example.com`;
    await seedLead({ email });
    const res = await axios.get(`/listings/${listingA}`, anonymous);
    expect(JSON.stringify(res.data)).not.toContain(email);
  });
});

describe('POST /staff/leads/:id/transition', () => {
  const post = (id: string, body: unknown, config = asModerator) =>
    axios.post(`/staff/leads/${id}/transition`, body, config);

  it('verifies a lead and records the actor, the role and the event', async () => {
    const id = await seedLead();
    const res = await post(id, { to: 'verified' });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id, from: 'new', to: 'verified' });
    const events = await pool().query<{
      to_status: string;
      actor_role: string;
      actor_account_id: string;
    }>(
      'SELECT to_status, actor_role, actor_account_id FROM lead_status_events WHERE lead_id = $1 ORDER BY created_at, id',
      [id],
    );
    expect(events.rows.map((e) => e.to_status)).toEqual(['new', 'verified']);
    expect(events.rows[1]).toMatchObject({ actor_role: 'Moderator', actor_account_id: moderator });
  });

  it('requires a note for spam and rejected, and stores it on the event', async () => {
    const id = await seedLead();
    expect((await post(id, { to: 'spam' })).status).toBe(400);
    expect((await post(id, { to: 'rejected', note: '   ' })).status).toBe(400);
    expect((await post(id, { to: 'spam', note: 'Bot traffic' })).status).toBe(200);
    const detail = staffLeadDetailSchema.parse(
      (await axios.get(`/staff/leads/${id}`, asAdmin)).data,
    );
    expect(detail.status).toBe('spam');
    expect(detail.history.at(-1)).toMatchObject({ toStatus: 'spam', note: 'Bot traffic' });
  });

  it('answers 409 when the transitions table forbids the change', async () => {
    const id = await seedLead({ status: 'closed' });
    const res = await post(id, { to: 'verified' }, asAdmin);
    expect(res.status).toBe(409);
    expect(res.data).toEqual(INVALID_TRANSITION_BODY);
    const status = await pool().query('SELECT status FROM listing_inquiries WHERE id = $1', [id]);
    expect(status.rows[0]).toEqual({ status: 'closed' });
  });

  it('lets only Admin restore spam to new', async () => {
    const id = await seedLead({ status: 'spam' });
    expect((await post(id, { to: 'new' }, asModerator)).status).toBe(403);
    expect((await post(id, { to: 'new' }, asSuperAdmin)).status).toBe(200);
  });

  it('answers 404 for an unknown lead', async () => {
    expect((await post(randomUUID(), { to: 'verified' })).status).toBe(404);
  });
});

describe('POST /staff/leads/:id/notes', () => {
  it('appends notes with author and time, and the detail shows them oldest first', async () => {
    const id = await seedLead();
    const first = await axios.post(
      `/staff/leads/${id}/notes`,
      { body: 'Left a voicemail' },
      asModerator,
    );
    expect(first.status).toBe(201);
    expect(first.data).toMatchObject({ authorAccountId: moderator, authorRole: 'Moderator' });
    await axios.post(`/staff/leads/${id}/notes`, { body: 'Reached the buyer' }, asAdmin);
    const detail = staffLeadDetailSchema.parse(
      (await axios.get(`/staff/leads/${id}`, asAdmin)).data,
    );
    expect(detail.notes.map((n) => n.body)).toEqual(['Left a voicemail', 'Reached the buyer']);
  });

  it('answers 404 for an unknown lead and 400 for a blank note', async () => {
    expect(
      (await axios.post(`/staff/leads/${randomUUID()}/notes`, { body: 'x' }, asAdmin)).status,
    ).toBe(404);
    const id = await seedLead();
    expect((await axios.post(`/staff/leads/${id}/notes`, { body: '  ' }, asAdmin)).status).toBe(
      400,
    );
  });

  it('cannot be edited or deleted in the database', async () => {
    const id = await seedLead();
    const note = await axios.post(`/staff/leads/${id}/notes`, { body: 'Keep me' }, asAdmin);
    await axios.get(`/staff/leads/${id}`, asAdmin);
    await expect(
      pool().query('UPDATE lead_notes SET body = $2 WHERE id = $1', [note.data.id, 'x']),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool().query('DELETE FROM lead_notes WHERE id = $1', [note.data.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool().query('DELETE FROM lead_access_audit WHERE lead_id = $1', [id]),
    ).rejects.toThrow(/append-only/);
  });
});
