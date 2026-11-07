import { recordRecentlyViewed } from './recently-viewed';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('recordRecentlyViewed', () => {
  it('posts the listing id to the app route', () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock;

    recordRecentlyViewed('L1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/recently-viewed');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ listingId: 'L1' });
  });

  it('stays silent when the call rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    expect(() => recordRecentlyViewed('L1')).not.toThrow();
    await Promise.resolve();
  });

  it('stays silent when fetch throws at once', () => {
    global.fetch = jest.fn(() => {
      throw new Error('boom');
    });

    expect(() => recordRecentlyViewed('L1')).not.toThrow();
  });
});
