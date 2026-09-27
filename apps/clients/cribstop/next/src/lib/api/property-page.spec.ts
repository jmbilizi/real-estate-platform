import { aPropertyMatch, aPropertyPage } from '@/test/fixtures';
import { loadPropertyPage, lookupProperty } from './property-page';

jest.mock('@/app/api/_lib/gateway', () => ({
  fetchGateway: jest.fn(),
}));

const { fetchGateway } = jest.requireMock('@/app/api/_lib/gateway') as { fetchGateway: jest.Mock };

function mockUpstream(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// Every case uses a distinct id/address segment: `loadPropertyPage`/`lookupProperty` are wrapped
// in React's `cache`, and reusing the same argument across cases would risk one test reading
// another's memoized result.

describe('loadPropertyPage', () => {
  afterEach(() => fetchGateway.mockReset());

  it('returns ready with the parsed page on 200', async () => {
    const page = aPropertyPage();
    fetchGateway.mockResolvedValue(mockUpstream(200, page));

    await expect(loadPropertyPage('listing-ready-1')).resolves.toEqual({
      status: 'ready',
      page,
    });
  });

  it('returns not-found on the contract 404', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(404, { error: { code: 'not_found', message: 'Property not found.' } }),
    );

    await expect(loadPropertyPage('listing-not-found-1')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('returns error when the gateway cannot be reached', async () => {
    fetchGateway.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(loadPropertyPage('listing-error-1')).resolves.toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('returns error when a 200 body fails contract validation', async () => {
    fetchGateway.mockResolvedValue(mockUpstream(200, { not: 'a property page' }));

    await expect(loadPropertyPage('listing-error-2')).resolves.toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('returns error on a non-404 failure status', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(500, { error: { code: 'internal_error', message: 'x' } }),
    );

    await expect(loadPropertyPage('listing-error-3')).resolves.toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });
});

describe('lookupProperty', () => {
  afterEach(() => fetchGateway.mockReset());

  it('returns ready with the single match', async () => {
    const match = aPropertyMatch();
    fetchGateway.mockResolvedValue(mockUpstream(200, { matches: [match] }));

    await expect(lookupProperty('alexandria-va', '118-baggett-place-1')).resolves.toEqual({
      status: 'ready',
      match,
    });
  });

  it('returns ambiguous with every match when more than one address resolves', async () => {
    const matches = [
      aPropertyMatch({ listingId: '11111111-1111-4111-8111-111111111111' }),
      aPropertyMatch({ listingId: '22222222-2222-4222-8222-222222222222' }),
    ];
    fetchGateway.mockResolvedValue(mockUpstream(200, { matches }));

    await expect(lookupProperty('alexandria-va', '118-baggett-place-2')).resolves.toEqual({
      status: 'ambiguous',
      matches,
    });
  });

  it('returns not-found on a 404 (no property)', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(404, { error: { code: 'not_found', message: 'x' } }),
    );

    await expect(lookupProperty('alexandria-va', '118-baggett-place-3')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('returns not-found on a 400 (bad segments)', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(400, { error: { code: 'invalid_request', message: 'x' } }),
    );

    await expect(lookupProperty('alexandria-va', '118-baggett-place-4')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('returns error when the gateway cannot be reached', async () => {
    fetchGateway.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(lookupProperty('alexandria-va', '118-baggett-place-5')).resolves.toEqual(
      expect.objectContaining({ status: 'error' }),
    );
  });
});
