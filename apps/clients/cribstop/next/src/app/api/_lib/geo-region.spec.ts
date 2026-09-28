import { fetchRegion, toRegion } from './geo-region';

describe('toRegion', () => {
  it('resolves a US city and state', () => {
    expect(
      toRegion({ city: 'Rockville', region: 'Maryland', regionCode: 'MD', countryCode: 'US' }),
    ).toEqual({ city: 'Rockville', state: 'MD' });
  });

  it('yields null for a non-US country', () => {
    expect(
      toRegion({ city: 'Toronto', region: 'Ontario', regionCode: 'ON', countryCode: 'CA' }),
    ).toBeNull();
  });

  it('yields null with no city or no region code', () => {
    expect(toRegion({ city: null, region: null, regionCode: null, countryCode: 'US' })).toBeNull();
    expect(toRegion({ city: 'Rockville', regionCode: null, countryCode: 'US' })).toBeNull();
  });

  it('yields null for a null body', () => {
    expect(toRegion(null)).toBeNull();
  });
});

describe('fetchRegion', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('forwards X-Real-IP to the gateway', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ city: 'Rockville', regionCode: 'MD', countryCode: 'US' }),
    });

    const region = await fetchRegion('203.0.113.5');

    expect(region).toEqual({ city: 'Rockville', state: 'MD' });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers as HeadersInit).get('X-Real-IP')).toBe('203.0.113.5');
  });

  it('yields null on a 204', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 204, json: () => Promise.resolve(null) });
    expect(await fetchRegion('203.0.113.5')).toBeNull();
  });

  it('yields null on a non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) });
    expect(await fetchRegion('203.0.113.5')).toBeNull();
  });

  it('yields null when the fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await fetchRegion('203.0.113.5')).toBeNull();
  });

  it('yields null with no client IP header to forward', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ city: 'Rockville', regionCode: 'MD', countryCode: 'US' }),
    });
    await fetchRegion(null);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers as HeadersInit).has('X-Real-IP')).toBe(false);
  });
});
