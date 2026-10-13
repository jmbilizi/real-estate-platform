import {
  bucketOf,
  fnv1a,
  inTreatment,
  feedRowTitle,
  isWarmProfile,
  parseHomeFeedFlags,
  titleSafeTarget,
} from './home-feed';

describe('parseHomeFeedFlags', () => {
  it('defaults to off', () => {
    expect(parseHomeFeedFlags({})).toEqual({ enabled: false, rolloutPct: 0 });
  });

  it('reads the flags and clamps the percent', () => {
    expect(
      parseHomeFeedFlags({ HOME_FEED_ENABLED: ' TRUE ', HOME_FEED_ROLLOUT_PCT: '25' }),
    ).toEqual({
      enabled: true,
      rolloutPct: 25,
    });
    expect(
      parseHomeFeedFlags({ HOME_FEED_ENABLED: 'true', HOME_FEED_ROLLOUT_PCT: '250' }).rolloutPct,
    ).toBe(100);
    expect(
      parseHomeFeedFlags({ HOME_FEED_ENABLED: 'true', HOME_FEED_ROLLOUT_PCT: '-5' }).rolloutPct,
    ).toBe(0);
    expect(
      parseHomeFeedFlags({ HOME_FEED_ENABLED: 'true', HOME_FEED_ROLLOUT_PCT: 'abc' }).rolloutPct,
    ).toBe(0);
  });

  it('any value but "true" is off', () => {
    expect(
      parseHomeFeedFlags({ HOME_FEED_ENABLED: '1', HOME_FEED_ROLLOUT_PCT: '50' }).enabled,
    ).toBe(false);
  });
});

describe('fnv1a', () => {
  it('matches the published 32-bit test vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('bucketOf', () => {
  it('is stable and inside 0 to 99', () => {
    const id = 'f'.repeat(32);
    expect(bucketOf(id)).toBe(bucketOf(id));
    expect(bucketOf(id)).toBeGreaterThanOrEqual(0);
    expect(bucketOf(id)).toBeLessThan(100);
  });

  it('splits visitors close to the rollout percent', () => {
    let treated = 0;
    const total = 5000;
    for (let i = 0; i < total; i++) {
      if (bucketOf(i.toString(16).padStart(32, '0')) < 20) treated++;
    }
    expect(treated / total).toBeGreaterThan(0.17);
    expect(treated / total).toBeLessThan(0.23);
  });
});

describe('inTreatment', () => {
  const id = 'b'.repeat(32);
  it('is false with the flag off, a 0 percent rollout or no anon id', () => {
    expect(inTreatment({ enabled: false, rolloutPct: 100 }, id)).toBe(false);
    expect(inTreatment({ enabled: true, rolloutPct: 0 }, id)).toBe(false);
    expect(inTreatment({ enabled: true, rolloutPct: 100 }, null)).toBe(false);
  });

  it('is true for everyone at 100 percent', () => {
    expect(inTreatment({ enabled: true, rolloutPct: 100 }, id)).toBe(true);
  });

  it('follows the bucket', () => {
    const b = bucketOf(id);
    expect(inTreatment({ enabled: true, rolloutPct: b }, id)).toBe(false);
    expect(inTreatment({ enabled: true, rolloutPct: b + 1 }, id)).toBe(true);
  });
});

describe('isWarmProfile', () => {
  const view = { listingId: 'x', kind: 'view' as const, side: 'sale' as const, at: 1 };
  it('matches the server rule', () => {
    expect(isWarmProfile(null)).toBe(false);
    expect(isWarmProfile({ items: [], places: [] })).toBe(false);
    expect(isWarmProfile({ items: [view, view], places: [] })).toBe(false);
    expect(isWarmProfile({ items: [view, view, view], places: [] })).toBe(true);
    expect(isWarmProfile({ items: [], places: ['Rockville, MD'] })).toBe(true);
    expect(isWarmProfile({ items: [{ ...view, kind: 'save' }], places: [] })).toBe(true);
  });
});

describe('titleSafeTarget', () => {
  const base = { city: 'Rockville', state: 'MD', confidence: 1, radiusKm: 8 };
  it('keeps a place the visitor chose or acted on', () => {
    for (const source of [
      'explicit',
      'last-search',
      'looking-for',
      'saved-home',
      'viewed-homes',
      'visit-views',
    ] as const) {
      expect(titleSafeTarget({ ...base, source })).not.toBeNull();
    }
  });

  it('drops a place from IP, geolocation, the default market or the rotation', () => {
    for (const source of ['ip', 'geolocation', 'default', 'rotation'] as const) {
      expect(titleSafeTarget({ ...base, source })).toBeNull();
    }
    expect(titleSafeTarget(null)).toBeNull();
  });
});

describe('feedRowTitle', () => {
  it('states the factual basis instead of Picked for you and your range', () => {
    expect(feedRowTitle('picked', 'Picked for you in Rockville, MD')).toBe(
      'Based on your activity in Rockville, MD',
    );
    expect(feedRowTitle('price-drops', 'Price drops in your range')).toBe('Recent price drops');
    expect(feedRowTitle('new', 'New in Rockville, MD')).toBe('New in Rockville, MD');
    expect(feedRowTitle('price-drops', 'Price drops in Rockville, MD')).toBe(
      'Price drops in Rockville, MD',
    );
  });
});
