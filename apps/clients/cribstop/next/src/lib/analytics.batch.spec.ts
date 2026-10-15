import {
  BATCH_MAX,
  FLUSH_INTERVAL_MS,
  flushEvents,
  pathTemplate,
  SESSION_IDLE_MS,
  surfaceFromPath,
  trackEvent,
} from './analytics';
import { ANON_ID_KEY, setPersonalisation } from './feed-profile';

const fetchMock = jest.fn();
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body) as any[]);
const events = () => bodies().flat();
const LISTING = '0190a000-0000-7000-8000-000000000001';

function setGpc(value: boolean | undefined) {
  Object.defineProperty(window.navigator, 'globalPrivacyControl', { value, configurable: true });
}

describe('trackEvent batching (#826)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    window.localStorage.clear();
    setGpc(undefined);
    // Empty the queue and the session-start flag left by an earlier test.
    jest.setSystemTime(Date.now() + 10 * SESSION_IDLE_MS);
    trackEvent('page_view');
    flushEvents();
    fetchMock.mockClear();
  });
  afterEach(() => {
    flushEvents();
    jest.useRealTimers();
  });

  it('holds impressions until 5 seconds pass, then sends one array', () => {
    for (let i = 0; i < 12; i++) {
      trackEvent('listing_impression', {
        listingId: LISTING,
        props: { row_id: 'near-you', card_position: i, list_type: 'grid' },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/events');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('omit');
    expect(events()).toHaveLength(12);
    expect(events()[3]).toMatchObject({
      event: 'listing_impression',
      row_id: 'near-you',
      card_position: 3,
      list_type: 'grid',
    });
  });

  it('sends queued impressions with the next non-impression event', () => {
    trackEvent('listing_impression', { listingId: LISTING });
    trackEvent('listing_click', { listingId: LISTING });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events().map((e) => e.event)).toEqual(['listing_impression', 'listing_click']);
  });

  it('flushes on pagehide and when the tab hides', () => {
    trackEvent('listing_impression', { listingId: LISTING });
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    trackEvent('listing_impression', { listingId: LISTING });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('flushes at 50 events and never sends more than 50 in one array', () => {
    for (let i = 0; i < BATCH_MAX + 1; i++)
      trackEvent('listing_impression', { listingId: LISTING });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodies()[0]).toHaveLength(BATCH_MAX);
    jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(events()).toHaveLength(BATCH_MAX + 1);
    expect(Math.max(...bodies().map((b) => b.length))).toBeLessThanOrEqual(BATCH_MAX);
  });

  it('stays under 120 requests per minute for a minute of scrolling', () => {
    for (let s = 0; s < 60; s++) {
      for (let i = 0; i < 8; i++) trackEvent('listing_impression', { listingId: LISTING });
      jest.advanceTimersByTime(1000);
    }
    // 480 impressions: ten 50-event batches at most plus the 5 s timer.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(15);
  });

  it('sends session_start first, once per session, with the anon id', () => {
    jest.setSystemTime(Date.now() + SESSION_IDLE_MS + 1);
    trackEvent('page_view');
    trackEvent('page_view');
    jest.setSystemTime(Date.now() + SESSION_IDLE_MS + 1);
    trackEvent('page_view');
    const all = events();
    expect(all.map((e) => e.event)).toEqual([
      'session_start',
      'page_view',
      'page_view',
      'session_start',
      'page_view',
    ]);
    expect(all[0].session_id).not.toBe(all[3].session_id);
    expect(all[0].anon_id).toMatch(/^[a-f0-9]{32}$/);
    expect(all[0]).toMatchObject({ is_new_anon: expect.any(Boolean), landing_path: '/' });
  });

  it('adds the path template and device, never the raw path', () => {
    trackEvent('page_view');
    expect(events().at(-1)).toMatchObject({ path_template: '/', device: expect.any(String) });
  });

  it('drops the queue and sends nothing after footer opt-out', () => {
    trackEvent('listing_impression', { listingId: LISTING });
    setPersonalisation(false);
    jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
    trackEvent('listing_click');
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ANON_ID_KEY)).toBeNull();
  });

  it('drops the queue and sends nothing under GPC', () => {
    trackEvent('listing_impression', { listingId: LISTING });
    setGpc(true);
    jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ANON_ID_KEY)).toBeNull();
    setGpc(undefined);
  });

  it('never throws when the post fails', () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(() => trackEvent('search', { surface: 'search' })).not.toThrow();
  });
});

describe('path helpers', () => {
  it('replaces ids and place names with a template', () => {
    expect(pathTemplate('/')).toBe('/');
    expect(pathTemplate('/listing/abc-123')).toBe('/listing/[id]');
    expect(pathTemplate('/property/12-main-st/0190a000')).toBe('/property/[slug]/[id]');
    expect(pathTemplate('/arlington-va/homes')).toBe('/[city]/[...rest]');
    expect(pathTemplate('/favorites')).toBe('/favorites');
    expect(pathTemplate('/admin/leads/42')).toBe('/admin/leads/[id]');
  });

  it('maps a path to a surface', () => {
    expect(surfaceFromPath('/')).toBe('home');
    expect(surfaceFromPath('/login')).toBe('auth');
    expect(surfaceFromPath('/favorites')).toBe('favorites');
  });
});
