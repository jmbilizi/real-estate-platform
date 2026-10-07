import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios, { type AxiosRequestConfig } from 'axios';
import { CONSENT_TEXTS, idSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { changeLeadStatus } from '../src/inquiries/lead-status-write';
import { complianceFixtureIds } from './support/fixture-ids';
import {
  bearerFor,
  setEmailUnconfirmed,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/**
 * `POST /listings/:id/inquiries` (#131) against a REAL service and REAL database.
 *
 * The service runs with the per-IP and per-listing limits raised, through the preload in
 * `support/e2e-serve-defaults.js` (#611). The suite posts more than 5 times from one IP. The limiter
 * mechanism (per-IP, per-listing, 429 with `Retry-After`) is covered by
 * `src/inquiries/rate-limit.spec.ts` and `src/app.spec.ts`.
 *
 * The service only stores an inquiry. It does not route it. Routing to the Cribstop buyer-agent
 * intake (ruling 2026-10-04) is out of scope here.
 */
const fixtures = complianceFixtureIds();

/** The service needs a signed-in account with a confirmed email (#690). The stub supplies both. */
const ACCOUNT_ID = randomUUID();
let stub: Server;

beforeAll(async () => {
  stub = await startIntrospectionStub();
});
afterAll(async () => {
  await stopIntrospectionStub(stub);
});

function post(url: string, body: unknown, config: AxiosRequestConfig = {}) {
  return axios.post(url, body, { headers: bearerFor(ACCOUNT_ID), ...config });
}

const VALID_BODY = {
  kind: 'tour_request' as const,
  consentToContact: true,
  consentTextVersion: 'v1' as const,
};

describe('POST /listings/:id/inquiries — signed-in', () => {
  it('creates an inquiry and returns 201 with a valid id', async () => {
    const response = await post(`/listings/${fixtures.sampleListingId}/inquiries`, VALID_BODY);

    expect(response.status).toBe(201);
    expect(idSchema.safeParse(response.data.id).success).toBe(true);
  });

  it('stores the account id and no copied contact columns (#691)', async () => {
    const response = await post(`/listings/${fixtures.sampleListingId}/inquiries`, {
      ...VALID_BODY,
      kind: 'message',
      message: 'Is this still available?',
    });

    expect(response.status).toBe(201);
    const { rows } = await getPool().query('SELECT * FROM listing_inquiries WHERE id = $1', [
      response.data.id,
    ]);
    expect(rows[0]).toMatchObject({ account_id: ACCOUNT_ID });
    for (const dropped of ['name', 'email', 'verified_account']) {
      expect(rows[0]).not.toHaveProperty(dropped);
    }
  });

  it('ignores a name and an email in the body', async () => {
    const response = await post(`/listings/${fixtures.sampleListingId}/inquiries`, {
      ...VALID_BODY,
      name: 'Typed Name',
      email: 'typed@example.com',
    });

    expect(response.status).toBe(201);
    const { rows } = await getPool().query('SELECT * FROM listing_inquiries WHERE id = $1', [
      response.data.id,
    ]);
    expect(JSON.stringify(rows[0])).not.toMatch(/Typed Name|typed@example.com/);
  });

  it('keeps the phone optional and per request', async () => {
    const response = await post(`/listings/${fixtures.sampleListingId}/inquiries`, {
      ...VALID_BODY,
      phone: '202-555-0100',
    });

    expect(response.status).toBe(201);
    const { rows } = await getPool().query('SELECT phone FROM listing_inquiries WHERE id = $1', [
      response.data.id,
    ]);
    expect(rows[0]).toEqual({ phone: '202-555-0100' });
  });
});

describe('POST /listings/:id/inquiries — account required (#690)', () => {
  const url = `/listings/${fixtures.sampleListingId}/inquiries`;

  it('answers 401 with no credential and writes nothing', async () => {
    const before = await getPool().query('SELECT count(*)::int AS n FROM listing_inquiries');

    const response = await axios.post(url, VALID_BODY, { validateStatus: () => true });

    expect(response.status).toBe(401);
    expect(response.data.error.code).toBe('unauthenticated');
    const after = await getPool().query('SELECT count(*)::int AS n FROM listing_inquiries');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('answers 401 for an unknown listing, so an anonymous caller learns nothing', async () => {
    const response = await axios.post(
      '/listings/0195f2d0-9999-7000-8000-00000000dead/inquiries',
      VALID_BODY,
      { validateStatus: () => true },
    );

    expect(response.status).toBe(401);
  });

  it('answers 403 for an account with an unconfirmed email', async () => {
    const unconfirmed = randomUUID();
    setEmailUnconfirmed(unconfirmed);

    const response = await axios.post(url, VALID_BODY, {
      headers: bearerFor(unconfirmed),
      validateStatus: () => true,
    });

    expect(response.status).toBe(403);
    expect(response.data.error.message).toMatch(/confirm your email/i);
  });
});

describe('POST /listings/:id/inquiries — e2e harness', () => {
  it('runs with the rate limits raised, so a sixth request from one IP is not a 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await post(`/listings/${fixtures.sampleListingId}/inquiries`, VALID_BODY);
      statuses.push(response.status);
    }

    expect(statuses).toEqual([201, 201, 201, 201, 201, 201]);
  });
});

describe('POST /listings/:id/inquiries — validation', () => {
  it('rejects an unknown field with 400 (Fair Housing guardrail, #34)', async () => {
    const response = await post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      { ...VALID_BODY, occupancy: 2 },
      { validateStatus: () => true },
    );

    expect(response.status).toBe(400);
    expect(response.data.error.code).toBe('invalid_request');
  });

  it('rejects kind "message" with no message', async () => {
    const response = await post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      { ...VALID_BODY, kind: 'message' },
      { validateStatus: () => true },
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /listings/:id/inquiries — listing visibility', () => {
  it('rejects an unknown id with 404', async () => {
    const response = await post(
      '/listings/0195f2d0-9999-7000-8000-00000000dead/inquiries',
      VALID_BODY,
      { validateStatus: () => true },
    );

    expect(response.status).toBe(404);
    expect(response.data.error.code).toBe('not_found');
  });

  it('rejects a malformed id with the same 404', async () => {
    const response = await post('/listings/not-a-uuid/inquiries', VALID_BODY, {
      validateStatus: () => true,
    });

    expect(response.status).toBe(404);
  });

  it('rejects a listing excluded from listing_search_v (internet_display_allowed = false)', async () => {
    // This listing exists as a row, but is not publishable — exactly the case #131's acceptance
    // criterion names, distinct from an unknown id.
    const response = await post(`/listings/${fixtures.suppressedListingId}/inquiries`, VALID_BODY, {
      validateStatus: () => true,
    });

    expect(response.status).toBe(404);
  });

  it('accepts an inquiry for a listing whose ADDRESS is suppressed — that is a different, weaker opt-out than internet_display_allowed', async () => {
    const response = await post(
      `/listings/${fixtures.suppressedAddressListingId}/inquiries`,
      VALID_BODY,
    );

    expect(response.status).toBe(201);
  });
});

describe('POST /listings/:id/inquiries — never exposed by a read endpoint', () => {
  it('does not appear anywhere in GET /listings/:id for the same listing', async () => {
    const response = await axios.get(`/listings/${fixtures.sampleListingId}`);

    expect(JSON.stringify(response.data)).not.toMatch(/inquir/i);
  });
});

describe('lead model (#627)', () => {
  const pool = getPool();
  afterAll(async () => {
    await closePool();
  });

  async function create(body: Record<string, unknown>): Promise<string> {
    const response = await post(`/listings/${fixtures.sampleListingId}/inquiries`, {
      ...VALID_BODY,
      ...body,
    });
    expect(response.status).toBe(201);
    return response.data.id as string;
  }

  async function row(id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query('SELECT * FROM listing_inquiries WHERE id = $1', [id]);
    return rows[0] as Record<string, unknown>;
  }

  it('creates a lead in status new, with one creation event', async () => {
    const id = await create({});

    expect(await row(id)).toMatchObject({ status: 'new', account_id: ACCOUNT_ID });
    const { rows } = await pool.query(
      'SELECT from_status, to_status, actor_account_id, actor_role FROM lead_status_events WHERE lead_id = $1',
      [id],
    );
    expect(rows).toEqual([
      { from_status: null, to_status: 'new', actor_account_id: null, actor_role: 'system' },
    ]);
  });

  it('refuses verifiedAccount in the body', async () => {
    const response = await post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      { ...VALID_BODY, verifiedAccount: true },
      { validateStatus: () => true },
    );

    expect(response.status).toBe(400);
  });

  it('records v1 and the default channels when consentTextVersion is absent (#631)', async () => {
    // JSON drops `undefined`, so the body carries no version.
    const id = await create({ consentTextVersion: undefined });

    expect(await row(id)).toMatchObject({
      consent_text_version: 'v1',
      consent_disclosure_text: CONSENT_TEXTS.v1,
      consent_channels: ['email'],
    });
  });

  it('stores the consent evidence: server text, version, channels and time', async () => {
    const id = await create({
      phone: '202-555-0100',
      consentToContact: true,
      consentTextVersion: 'v1',
      consentChannels: ['phone_text', 'email'],
    });

    const stored = await row(id);
    expect(stored).toMatchObject({
      consent_to_contact: true,
      consent_disclosure_text: CONSENT_TEXTS.v1,
      consent_text_version: 'v1',
      consent_channels: ['phone_text', 'email'],
    });
    expect(stored.consent_given_at).toBeInstanceOf(Date);
  });

  it('defaults the channels to email', async () => {
    const id = await create({});

    expect(await row(id)).toMatchObject({
      consent_text_version: 'v1',
      consent_channels: ['email'],
    });
  });

  it('stores no consent evidence without consent', async () => {
    const id = await create({ consentToContact: false, consentTextVersion: undefined });

    expect(await row(id)).toMatchObject({
      consent_to_contact: false,
      consent_disclosure_text: null,
      consent_text_version: null,
      consent_channels: null,
    });
  });

  it('changes status and appends the audit event in one transaction', async () => {
    const id = await create({});
    const actor = '0195f2d0-9999-7000-8000-0000000000a1';

    const result = await changeLeadStatus(pool, {
      leadId: id,
      to: 'verified',
      actorAccountId: actor,
      actorRole: 'moderator',
      note: 'phone checked',
    });

    expect(result).toEqual({ ok: true, from: 'new', to: 'verified' });
    expect(await row(id)).toMatchObject({ status: 'verified' });
    const { rows } = await pool.query(
      'SELECT from_status, to_status, actor_account_id, actor_role, note ' +
        'FROM lead_status_events WHERE lead_id = $1 ORDER BY created_at, id',
      [id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      from_status: 'new',
      to_status: 'verified',
      actor_account_id: actor,
      actor_role: 'moderator',
      note: 'phone checked',
    });
  });

  it('refuses a transition the table forbids and leaves status and events unchanged', async () => {
    const id = await create({});

    const result = await changeLeadStatus(pool, {
      leadId: id,
      to: 'closed',
      actorAccountId: null,
      actorRole: 'system',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_transition', from: 'new' });
    expect(await row(id)).toMatchObject({ status: 'new' });
    const { rows } = await pool.query('SELECT 1 FROM lead_status_events WHERE lead_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('keeps the audit trail append-only', async () => {
    const id = await create({});

    await expect(
      pool.query("UPDATE lead_status_events SET note = 'x' WHERE lead_id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query('DELETE FROM lead_status_events WHERE lead_id = $1', [id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('TRUNCATE lead_status_events')).rejects.toThrow(/append-only/);
  });

  it('rejects a bad status at the database', async () => {
    const id = await create({});

    await expect(
      pool.query("UPDATE listing_inquiries SET status = 'bogus' WHERE id = $1", [id]),
    ).rejects.toThrow(/status_check/);
  });
});
