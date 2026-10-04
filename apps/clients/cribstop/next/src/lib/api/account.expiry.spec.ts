type AccountModule = typeof import('./account');

function load(): AccountModule {
  let mod!: AccountModule;
  jest.isolateModules(() => {
    mod = require('./account');
  });
  return mod;
}

const ok = (expiryHours: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ expiryHours }) }) as unknown as Response;

describe('getConfirmationExpiryHours', () => {
  it('retries after a rejected lookup and then caches the real value', async () => {
    const { getConfirmationExpiryHours } = load();
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok(48));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getConfirmationExpiryHours()).resolves.toBe(24);
    await expect(getConfirmationExpiryHours()).resolves.toBe(48);
    await expect(getConfirmationExpiryHours()).resolves.toBe(48);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a non-OK response', { ok: false, status: 503 } as Response],
    ['an invalid body', ok('soon')],
  ])('returns the default for %s and retries on the next call', async (_name, bad) => {
    const { getConfirmationExpiryHours } = load();
    const fetchMock = jest.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(ok(12));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getConfirmationExpiryHours()).resolves.toBe(24);
    await expect(getConfirmationExpiryHours()).resolves.toBe(12);
  });

  it('shares one request between concurrent calls', async () => {
    const { getConfirmationExpiryHours } = load();
    const fetchMock = jest.fn().mockResolvedValue(ok(36));
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await Promise.all([getConfirmationExpiryHours(), getConfirmationExpiryHours()]);

    expect(results).toEqual([36, 36]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
