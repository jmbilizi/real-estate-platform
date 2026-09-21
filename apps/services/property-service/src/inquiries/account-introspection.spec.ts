import { createHttpIntrospectionClient } from './account-introspection';

const OPTIONS = {
  url: 'http://account-service-svc:8080/internal/account/introspect',
  timeoutMs: 1000,
};

describe('createHttpIntrospectionClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('makes no network call at all when no credential header is present', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const accountId = await createHttpIntrospectionClient(OPTIONS).resolveAccountId({});

    expect(accountId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the cookie header verbatim and resolves the account id on a valid response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ isValid: true, credentialType: 'cookie', accountId: 'acct-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const accountId = await createHttpIntrospectionClient(OPTIONS).resolveAccountId({
      cookie: '.AspNetCore.Identity.Application=abc',
    });

    expect(accountId).toBe('acct-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Cookie).toBe('.AspNetCore.Identity.Application=abc');
  });

  it('forwards the Authorization header verbatim', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ isValid: true, accountId: 'acct-2' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createHttpIntrospectionClient(OPTIONS).resolveAccountId({
      authorization: 'Bearer some-token',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer some-token');
  });

  it('forwards the API key header under X-Api-Key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ isValid: true, accountId: 'acct-3' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await createHttpIntrospectionClient(OPTIONS).resolveAccountId({ apiKey: 'key-123' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Api-Key']).toBe('key-123');
  });

  it('resolves null when the credential is present but invalid', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ isValid: false, accountId: null }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const accountId = await createHttpIntrospectionClient(OPTIONS).resolveAccountId({
      cookie: 'stale=1',
    });

    expect(accountId).toBeNull();
  });

  it('fails open to signed-out on a non-2xx response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const accountId = await createHttpIntrospectionClient(OPTIONS).resolveAccountId({
      cookie: 'x=1',
    });

    expect(accountId).toBeNull();
  });

  it('fails open to signed-out on a network error, never rejecting the caller', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const accountId = await createHttpIntrospectionClient(OPTIONS).resolveAccountId({
      cookie: 'x=1',
    });

    expect(accountId).toBeNull();
  });
});
