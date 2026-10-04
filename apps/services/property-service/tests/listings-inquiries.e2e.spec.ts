import axios from 'axios';
import { idSchema } from '@cribstop/property-contracts';
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
