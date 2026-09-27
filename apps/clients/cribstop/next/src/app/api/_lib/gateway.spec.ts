/**
 * #402: `API_GATEWAY_BASIC_AUTH` lets a frontend-only lane reach the deployed dev gateway, whose
 * ingress requires nginx basic auth. Node fetch rejects credentials embedded in a URL, so the
 * header path is the only one that works — this asserts the header is built correctly, is never
 * sent when unset, and is refused in production against a cluster-internal gateway URL.
 */
import { fetchGateway, gatewayBaseUrl } from './gateway';

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('gatewayBaseUrl', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to localhost:8080 outside production', () => {
    setEnv({ API_GATEWAY_URL: undefined, NODE_ENV: 'test' });
    expect(gatewayBaseUrl()).toBe('http://localhost:8080');
  });

  it('strips a trailing slash from a configured URL', () => {
    setEnv({ API_GATEWAY_URL: 'https://dev.example.com/' });
    expect(gatewayBaseUrl()).toBe('https://dev.example.com');
  });
});

describe('fetchGateway basic auth header', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('sends no Authorization header when API_GATEWAY_BASIC_AUTH is unset', async () => {
    setEnv({
      API_GATEWAY_URL: 'https://dev.cribstop.example.com',
      API_GATEWAY_BASIC_AUTH: undefined,
      NODE_ENV: 'test',
    });

    await fetchGateway('/property/listings/1', { method: 'GET' });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).has('Authorization')).toBe(false);
  });

  it('sends a base64 Basic Authorization header when API_GATEWAY_BASIC_AUTH is set', async () => {
    setEnv({
      API_GATEWAY_URL: 'https://dev.cribstop.example.com',
      API_GATEWAY_BASIC_AUTH: 'devuser:sup3r-secret',
      NODE_ENV: 'test',
    });

    await fetchGateway('/property/listings/1', { method: 'GET' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://dev.cribstop.example.com/property/listings/1');
    const expected = `Basic ${Buffer.from('devuser:sup3r-secret').toString('base64')}`;
    expect((init.headers as Headers).get('Authorization')).toBe(expected);
  });

  it('preserves caller-supplied headers alongside the Authorization header', async () => {
    setEnv({
      API_GATEWAY_URL: 'https://dev.cribstop.example.com',
      API_GATEWAY_BASIC_AUTH: 'devuser:sup3r-secret',
      NODE_ENV: 'test',
    });

    await fetchGateway('/property/listings/1', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(true);
  });

  it('never overwrites a caller-supplied Authorization header (e.g. a user Bearer token)', async () => {
    setEnv({
      API_GATEWAY_URL: 'https://dev.cribstop.example.com',
      API_GATEWAY_BASIC_AUTH: 'devuser:sup3r-secret',
      NODE_ENV: 'test',
    });

    await fetchGateway('/account/profile', {
      method: 'GET',
      headers: { Authorization: 'Bearer user-token' },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer user-token');
  });

  it('refuses to send the header in production against a cluster-internal gateway URL', async () => {
    setEnv({
      API_GATEWAY_URL: 'http://api-gateway-svc:8080',
      API_GATEWAY_BASIC_AUTH: 'devuser:sup3r-secret',
      NODE_ENV: 'production',
    });

    await expect(fetchGateway('/property/listings/1', { method: 'GET' })).rejects.toThrow(
      /cluster-internal/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows the header in production against a non-cluster-internal (dev ingress) URL', async () => {
    setEnv({
      API_GATEWAY_URL: 'https://dev.cribstop.example.com',
      API_GATEWAY_BASIC_AUTH: 'devuser:sup3r-secret',
      NODE_ENV: 'production',
    });

    await fetchGateway('/property/listings/1', { method: 'GET' });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).has('Authorization')).toBe(true);
  });
});
