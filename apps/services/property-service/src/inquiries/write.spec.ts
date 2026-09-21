import { CONSENT_DISCLOSURE_TEXT } from '@cribstop/property-contracts';
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
  name: 'Jane Consumer',
  email: 'jane@example.com',
  phone: null,
  message: null,
  accountId: null,
  consentToContact: false,
};

describe('createListingInquiry', () => {
  it('inserts into listing_inquiries and returns the created id', async () => {
    const { client, calls } = fakeClient('018f2f2a-6d1b-7c3d-8b2e-0000000000aa');

    const id = await createListingInquiry(client, BASE_INPUT);

    expect(id).toBe('018f2f2a-6d1b-7c3d-8b2e-0000000000aa');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/INSERT\s+INTO\s+listing_inquiries/i);
  });

  it('never persists a caller-supplied disclosure string — only the canonical constant', async () => {
    const { client, calls } = fakeClient();

    await createListingInquiry(client, { ...BASE_INPUT, consentToContact: true });

    expect(calls[0]?.params).toContain(CONSENT_DISCLOSURE_TEXT);
  });

  it('records no disclosure text or timestamp expression evaluated when consent is false', async () => {
    const { client, calls } = fakeClient();

    await createListingInquiry(client, { ...BASE_INPUT, consentToContact: false });

    expect(calls[0]?.params).not.toContain(CONSENT_DISCLOSURE_TEXT);
    // The last bound param is the disclosure text; it must be null when consent is false.
    const params = calls[0]?.params ?? [];
    expect(params[params.length - 1]).toBeNull();
  });

  it('throws rather than returning undefined when the insert yields no row', async () => {
    const client: Queryable = { query: () => Promise.resolve({ rows: [] }) };

    await expect(createListingInquiry(client, BASE_INPUT)).rejects.toThrow();
  });
});
