import { getAnalyticsSessionId, surfaceFromPath, trackEvent } from './analytics';

describe('analytics', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('keeps one session id in memory and writes no storage', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    expect(getAnalyticsSessionId()).toMatch(/^[a-f0-9]{32}$/);
    expect(getAnalyticsSessionId()).toBe(getAnalyticsSessionId());
    trackEvent('search');
    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
  });

  it('posts with keepalive and without credentials', () => {
    trackEvent('listing_view', {
      surface: 'detail',
      listingId: '0190a000-0000-7000-8000-0000000000e1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/events');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body)).toMatchObject({ event: 'listing_view', surface: 'detail' });
  });

  it('never throws when the post fails', () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => trackEvent('search', { surface: 'map' })).not.toThrow();
  });

  it('maps a path to a surface', () => {
    expect(surfaceFromPath('/favorites')).toBe('favorites');
    expect(surfaceFromPath('/listing/abc')).toBe('detail');
    expect(surfaceFromPath('/search')).toBe('search');
  });
});
