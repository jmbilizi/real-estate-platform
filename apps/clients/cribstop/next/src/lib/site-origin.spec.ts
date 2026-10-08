/** @jest-environment jsdom */
import { setSiteOriginForTest, shareOrigin, warmSiteOrigin } from './site-origin';

afterEach(() => {
  setSiteOriginForTest(null);
  jest.restoreAllMocks();
});

function mockFetch(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as never;
}

describe('shareOrigin', () => {
  it('falls back to the current origin when SITE_ORIGIN is unset', async () => {
    mockFetch({ origin: null });
    await warmSiteOrigin();
    expect(shareOrigin()).toBe(window.location.origin);
  });

  it('uses the configured origin once warmed', async () => {
    mockFetch({ origin: 'https://cribstop.com' });
    await warmSiteOrigin();
    expect(shareOrigin()).toBe('https://cribstop.com');
  });

  it('keeps the fallback when the request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    await warmSiteOrigin();
    expect(shareOrigin()).toBe(window.location.origin);
  });
});
