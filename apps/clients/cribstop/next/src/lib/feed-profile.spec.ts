import {
  clearFeedProfile,
  FEED_PROFILE_KEY,
  getFeedRequestProfile,
  getVisitStart,
  isPersonalisationEnabled,
  MAX_PROFILE_ITEMS,
  readItems,
  recordFeedItem,
  setPersonalisation,
} from './feed-profile';

function setGpc(value: boolean | undefined) {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value, configurable: true });
}

describe('feed profile', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setGpc(undefined);
  });

  it('keeps the newest 50 items', () => {
    for (let i = 0; i < 60; i++) recordFeedItem(`l${i}`, 'view', 'sale', i);
    const items = getFeedRequestProfile()!.items;
    expect(items).toHaveLength(MAX_PROFILE_ITEMS);
    expect(items[0].listingId).toBe('l59');
    expect(items[49].listingId).toBe('l10');
  });

  it('keeps one entry per listing and a save outranks a view', () => {
    recordFeedItem('a', 'save', 'rent', 1);
    recordFeedItem('a', 'view', 'rent', 2);
    const items = getFeedRequestProfile()!.items;
    expect(items).toEqual([{ listingId: 'a', kind: 'save', side: 'rent', at: 2 }]);
  });

  it('reads at most 5 places from recentSearches', () => {
    const searches = Array.from({ length: 8 }, (_, i) => ({ display_name: `Place ${i}` }));
    window.localStorage.setItem('recentSearches', JSON.stringify(searches));
    expect(getFeedRequestProfile()!.places).toEqual([
      'Place 0',
      'Place 1',
      'Place 2',
      'Place 3',
      'Place 4',
    ]);
  });

  it('keeps the listing place on this device and leaves it out of the request', () => {
    recordFeedItem('a', 'view', 'sale', 5, { city: 'Rockville', state: 'MD' });
    expect(readItems()[0]).toMatchObject({ city: 'Rockville', state: 'MD' });
    expect(getFeedRequestProfile()!.items).toEqual([
      { listingId: 'a', kind: 'view', side: 'sale', at: 5 },
    ]);
  });

  it('starts the visit at the first recorded item and keeps it', () => {
    window.sessionStorage.clear();
    const before = Date.now();
    recordFeedItem('a', 'view');
    const start = getVisitStart();
    expect(start).toBeGreaterThanOrEqual(before);
    recordFeedItem('b', 'view');
    expect(getVisitStart()).toBe(start);
  });

  it('writes and sends nothing when the switch is off, and deletes the stored profile', () => {
    recordFeedItem('a', 'view');
    setPersonalisation(false);
    expect(window.localStorage.getItem(FEED_PROFILE_KEY)).toBeNull();
    recordFeedItem('b', 'view');
    expect(window.localStorage.getItem(FEED_PROFILE_KEY)).toBeNull();
    expect(getFeedRequestProfile()).toBeNull();
    setPersonalisation(true);
    expect(isPersonalisationEnabled()).toBe(true);
  });

  it('writes and sends nothing when Global Privacy Control is on', () => {
    setGpc(true);
    recordFeedItem('a', 'view');
    expect(window.localStorage.getItem(FEED_PROFILE_KEY)).toBeNull();
    expect(getFeedRequestProfile()).toBeNull();
  });

  it('clears the profile', () => {
    recordFeedItem('a', 'view');
    clearFeedProfile();
    expect(getFeedRequestProfile()!.items).toEqual([]);
  });
});
