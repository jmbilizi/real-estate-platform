import axios from 'axios';
import { CONSENT_TEXTS, idSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { changeLeadStatus } from '../src/inquiries/lead-status-write';
import { complianceFixtureIds } from './support/fixture-ids';

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

const VALID_BODY = {
  kind: 'tour_request' as const,
  name: 'Jane Consumer (e2e)',
  email: 'jane.e2e@example.com',
  consentToContact: true,
  consentTextVersion: 'v1' as const,
};

describe('POST /listings/:id/inquiries — signed-out', () => {
  it('creates an inquiry and returns 201 with a valid id', async () => {
    const response = await axios.post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      VALID_BODY,
    );

    expect(response.status).toBe(201);
    expect(idSchema.safeParse(response.data.id).success).toBe(true);
  });

  it('never rejects for lacking a credential', async () => {
    const response = await axios.post(`/listings/${fixtures.sampleListingId}/inquiries`, {
      ...VALID_BODY,
      kind: 'message',
      message: 'Is this still available?',
    });

    expect(response.status).toBe(201);
  });
});

describe('POST /listings/:id/inquiries — e2e harness', () => {
  it('runs with the rate limits raised, so a sixth request from one IP is not a 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await axios.post(
        `/listings/${fixtures.sampleListingId}/inquiries`,
        VALID_BODY,
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([201, 201, 201, 201, 201, 201]);
  });
});

describe('POST /listings/:id/inquiries — validation', () => {
  it('rejects an unknown field with 400 (Fair Housing guardrail, #34)', async () => {
    const response = await axios.post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      { ...VALID_BODY, occupancy: 2 },
      { validateStatus: () => true },
    );

    expect(response.status).toBe(400);
    expect(response.data.error.code).toBe('invalid_request');
  });

  it('rejects kind "message" with no message', async () => {
    const response = await axios.post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      { ...VALID_BODY, kind: 'message' },
      { validateStatus: () => true },
    );

    expect(response.status).toBe(400);
  });

  it('rejects a missing email', async () => {
    const { email: _email, ...withoutEmail } = VALID_BODY;
    const response = await axios.post(
      `/listings/${fixtures.sampleListingId}/inquiries`,
      withoutEmail,
      { validateStatus: () => true },
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /listings/:id/inquiries — listing visibility', () => {
  it('rejects an unknown id with 404', async () => {
    const response = await axios.post(
      '/listings/0195f2d0-9999-7000-8000-00000000dead/inquiries',
      VALID_BODY,
      { validateStatus: () => true },
    );

    expect(response.status).toBe(404);
    expect(response.data.error.code).toBe('not_found');
  });

  it('rejects a malformed id with the same 404', async () => {
    const response = await axios.post('/listings/not-a-uuid/inquiries', VALID_BODY, {
      validateStatus: () => true,
    });

    expect(response.status).toBe(404);
  });

  it('rejects a listing excluded from listing_search_v (internet_display_allowed = false)', async () => {
    // This listing exists as a row, but is not publishable — exactly the case #131's acceptance
    // criterion names, distinct from an unknown id.
    const response = await axios.post(
      `/listings/${fixtures.suppressedListingId}/inquiries`,
      VALID_BODY,
      { validateStatus: () => true },
    );

    expect(response.status).toBe(404);
  });

  it('accepts an inquiry for a listing whose ADDRESS is suppressed — that is a different, weaker opt-out than internet_display_allowed', async () => {
    const response = await axios.post(
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
    const response = await axios.post(`/listings/${fixtures.sampleListingId}/inquiries`, {
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

  it('creates a lead in status new, unverified, with one creation event', async () => {
    const id = await create({});

    expect(await row(id)).toMatchObject({ status: 'new', verified_account: false });
    const { rows } = await pool.query(
      'SELECT from_status, to_status, actor_account_id, actor_role FROM lead_status_events WHERE lead_id = $1',
      [id],
    );
    expect(rows).toEqual([
      { from_status: null, to_status: 'new', actor_account_id: null, actor_role: 'system' },
    ]);
  });

  it('refuses verifiedAccount in the body', async () => {
    const response = await axios.post(
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

  it('defaults the channels to the supplied contact details', async () => {
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
