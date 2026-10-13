import { getAnalyticsSessionId, SESSION_IDLE_MS, surfaceFromPath, trackEvent } from './analytics';
import { ANON_ID_KEY, PERSONALISE_KEY, setPersonalisation } from './feed-profile';
import { ANON_ID_MAX_AGE_MS, getAnonId } from './anon-id';

function setGpc(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'globalPrivacyControl', {
    value,
    configurable: true,
  });
}

describe('analytics', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.localStorage.clear();
    setGpc(undefined);
  });

  it('keeps one session id in memory and sets no cookie', () => {
    expect(getAnalyticsSessionId()).toMatch(/^[a-f0-9]{32}$/);
    expect(getAnalyticsSessionId()).toBe(getAnalyticsSessionId());
    expect(document.cookie).toBe('');
  });

  it('resets the session id after 30 idle minutes', () => {
    const t = Date.now() + 10 * SESSION_IDLE_MS;
    const first = getAnalyticsSessionId(t);
    expect(getAnalyticsSessionId(t + SESSION_IDLE_MS - 1)).toBe(first);
    const lastSeen = t + SESSION_IDLE_MS - 1;
    expect(getAnalyticsSessionId(lastSeen + SESSION_IDLE_MS + 1)).not.toBe(first);
  });

  it('posts with keepalive, without credentials, with the anon id', () => {
    trackEvent('listing_view', {
      surface: 'detail',
      listingId: '0190a000-0000-7000-8000-0000000000e1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/events');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('omit');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ event: 'listing_view', surface: 'detail' });
    expect(body.anon_id).toBe(getAnonId());
    expect(body.session_id).toMatch(/^[a-f0-9]{32}$/);
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

describe('anon id', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setGpc(undefined);
  });

  it('is a 128-bit hex code that stays the same across calls', () => {
    const id = getAnonId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(getAnonId()).toBe(id);
  });

  it('rotates after 13 months', () => {
    const t0 = 1_700_000_000_000;
    const id = getAnonId(t0);
    expect(getAnonId(t0 + ANON_ID_MAX_AGE_MS - 1)).toBe(id);
    expect(getAnonId(t0 + ANON_ID_MAX_AGE_MS + 1)).not.toBe(id);
  });
});

describe('opt-out', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.localStorage.clear();
    setGpc(undefined);
  });
  afterEach(() => setGpc(undefined));

  it('footer switch off deletes the id and stops every send', () => {
    getAnonId();
    expect(window.localStorage.getItem(ANON_ID_KEY)).not.toBeNull();
    setPersonalisation(false);
    expect(window.localStorage.getItem(ANON_ID_KEY)).toBeNull();
    trackEvent('search');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ANON_ID_KEY)).toBeNull();
    expect(window.localStorage.getItem(PERSONALISE_KEY)).toBe('off');
  });

  it('GPC deletes the id and stops every send', () => {
    getAnonId();
    setGpc(true);
    trackEvent('search');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ANON_ID_KEY)).toBeNull();
    expect(getAnonId()).toBeNull();
  });

  it('switching back on makes a new id', () => {
    const before = getAnonId();
    setPersonalisation(false);
    setPersonalisation(true);
    const after = getAnonId();
    expect(after).toMatch(/^[a-f0-9]{32}$/);
    expect(after).not.toBe(before);
  });
});
