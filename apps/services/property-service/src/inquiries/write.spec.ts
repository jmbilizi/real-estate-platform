import { CONSENT_TEXTS } from '@cribstop/property-contracts';
import { createListingInquiry, type Queryable } from './write';

function fakeClient(returnId = '018f2f2a-6d1b-7c3d-8b2e-0000000000aa'): {
  client: Queryable;
  calls: { sql: string; params: unknown[] }[];
} {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = ((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return Promise.resolve({ rows: [{ id: returnId }] });
  }) as Queryable['query'];
  return { calls, client: { query } };
}

const BASE_INPUT = {
  listingId: '018f2f2a-6d1b-7c3d-8b2e-000000000001',
  kind: 'tour_request' as const,
  phone: null,
  message: null,
  accountId: '018f2f2a-6d1b-7c3d-8b2e-0000000000dd',
  consentToContact: false,
};

// Bound parameter positions in `createListingInquiry`.
const P_ACCOUNT = 4;
const P_TEXT = 6;
const P_VERSION = 7;
const P_CHANNELS = 8;

describe('createListingInquiry', () => {
  it('inserts the inquiry and its creation event in one statement, and returns the id', async () => {
    const { client, calls } = fakeClient('018f2f2a-6d1b-7c3d-8b2e-0000000000aa');

    const id = await createListingInquiry(client, BASE_INPUT);

    expect(id).toBe('018f2f2a-6d1b-7c3d-8b2e-0000000000aa');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/INSERT\s+INTO\s+listing_inquiries/i);
    expect(calls[0]?.sql).toMatch(/INSERT\s+INTO\s+lead_status_events/i);
  });

  it('stores the server text for the version, never a caller string', async () => {
    const { client, calls } = fakeClient();

    await createListingInquiry(client, { ...BASE_INPUT, consentToContact: true });

    expect(calls[0]?.params[P_TEXT]).toBe(CONSENT_TEXTS.v1);
    expect(calls[0]?.params[P_VERSION]).toBe('v1');
  });

  it('defaults the channels to email, plus phone call and text with a phone', async () => {
    const emailOnly = fakeClient();
    await createListingInquiry(emailOnly.client, { ...BASE_INPUT, consentToContact: true });
    expect(emailOnly.calls[0]?.params[P_CHANNELS]).toEqual(['email']);

    const withPhone = fakeClient();
    await createListingInquiry(withPhone.client, {
      ...BASE_INPUT,
      phone: '202-555-0100',
      consentToContact: true,
    });
    expect(withPhone.calls[0]?.params[P_CHANNELS]).toEqual(['email', 'phone_call', 'phone_text']);
  });

  it('stores the channels the caller named', async () => {
    const { client, calls } = fakeClient();

    await createListingInquiry(client, {
      ...BASE_INPUT,
      phone: '202-555-0100',
      consentToContact: true,
      consentChannels: ['phone_text'],
    });

    expect(calls[0]?.params[P_CHANNELS]).toEqual(['phone_text']);
  });

  it('records no text, version or channels when consent is false', async () => {
    const { client, calls } = fakeClient();

    await createListingInquiry(client, {
      ...BASE_INPUT,
      consentToContact: false,
      consentTextVersion: 'v1',
      consentChannels: ['email'],
    });

    const params = calls[0]?.params ?? [];
    expect(params[P_TEXT]).toBeNull();
    expect(params[P_VERSION]).toBeNull();
    expect(params[P_CHANNELS]).toBeNull();
  });

  it('stores the account id and no copied name, email or verified flag (#691)', async () => {
    const { client, calls } = fakeClient();

    await createListingInquiry(client, BASE_INPUT);

    expect(calls[0]?.params[P_ACCOUNT]).toBe(BASE_INPUT.accountId);
    expect(calls[0]?.sql).not.toMatch(/verified_account|recipient_ref/);
    expect(calls[0]?.sql).not.toMatch(/\(listing_id, kind, (name|email)/);
  });

  it('throws rather than returning undefined when the insert yields no row', async () => {
    const client: Queryable = { query: () => Promise.resolve({ rows: [] }) };

    await expect(createListingInquiry(client, BASE_INPUT)).rejects.toThrow();
  });
});
