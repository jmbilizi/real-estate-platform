import axios from 'axios';
import { idSchema } from '@cribstop/property-contracts';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * `POST /listings/:id/inquiries` (#131) against a REAL service and REAL database.
 *
 * Rate limiting is deliberately NOT exercised here. This suite runs against one long-lived server
 * for the whole `nx e2e` invocation, so the in-memory limiter's counters persist across every test
 * in this file (and, if a future spec file also posts inquiries, across files too). Asserting exact
 * counts against shared mutable state is flaky and would leak into unrelated tests. The mechanism
 * itself — per-IP, per-listing, 429 with `Retry-After`, no SQL run when refused — is covered at the
 * unit level (`src/inquiries/rate-limit.spec.ts`) and the HTTP-with-injected-fake level
 * (`src/app.spec.ts`), both of which control the limiter's state directly.
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
