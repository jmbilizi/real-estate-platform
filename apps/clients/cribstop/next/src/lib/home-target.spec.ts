import {
  LAST_SEARCH_MAX_AGE_DAYS,
  placeFromLookingFor,
  resolveHomeTarget,
  roundCoordinate,
} from './home-target';

const NOW = Date.UTC(2026, 9, 13);
const DAY = 24 * 60 * 60 * 1000;
const dc = { city: 'Washington', state: 'DC' };
const rich = { city: 'Richmond', state: 'VA' };
const bal = { city: 'Baltimore', state: 'MD' };
const ash = { city: 'Ashburn', state: 'VA' };

describe('resolveHomeTarget', () => {
  it('returns null with no source', () => {
    expect(resolveHomeTarget({ now: NOW })).toBeNull();
  });

  it('ranks explicit above every other source', () => {
    const t = resolveHomeTarget({
      explicit: dc,
      lastSearch: { ...rich, searchedAt: NOW },
      geolocation: bal,
      ip: ash,
      now: NOW,
    });
    expect(t).toEqual({ ...dc, source: 'explicit' });
  });

  it('ranks a recent search above geolocation, which ranks above the IP region', () => {
    const base = { geolocation: bal, ip: ash, now: NOW };
    expect(resolveHomeTarget({ ...base, lastSearch: { ...rich, searchedAt: NOW - DAY } })).toEqual({
      ...rich,
      source: 'last-search',
    });
    expect(resolveHomeTarget(base)).toEqual({ ...bal, source: 'geolocation' });
    expect(resolveHomeTarget({ ip: ash, now: NOW })).toEqual({ ...ash, source: 'ip' });
  });

  it('ignores a search older than the window and falls to geolocation', () => {
    const old = { ...rich, searchedAt: NOW - (LAST_SEARCH_MAX_AGE_DAYS + 1) * DAY };
    expect(resolveHomeTarget({ lastSearch: old, geolocation: bal, now: NOW })?.source).toBe(
      'geolocation',
    );
  });

  it('keeps a search that has no timestamp', () => {
    expect(resolveHomeTarget({ lastSearch: rich, ip: ash, now: NOW })?.source).toBe('last-search');
  });

  it('ranks preferences above saved homes, and both above the IP region', () => {
    expect(resolveHomeTarget({ lookingFor: dc, savedHome: rich, ip: ash })?.source).toBe(
      'looking-for',
    );
    expect(resolveHomeTarget({ savedHome: rich, ip: ash })?.source).toBe('saved-home');
  });

  it('ranks the default market last', () => {
    expect(resolveHomeTarget({ defaultMarket: dc })?.source).toBe('default');
    expect(resolveHomeTarget({ defaultMarket: dc, ip: ash })?.source).toBe('ip');
  });

  it('skips a place with no city or a malformed state', () => {
    expect(resolveHomeTarget({ geolocation: { city: '', state: 'VA' }, ip: ash })?.source).toBe(
      'ip',
    );
    expect(
      resolveHomeTarget({ geolocation: { city: 'X', state: 'Virginia' }, ip: ash })?.source,
    ).toBe('ip');
  });

  it('normalizes the state to upper case', () => {
    expect(resolveHomeTarget({ ip: { city: 'Reston', state: 'va' } })).toEqual({
      city: 'Reston',
      state: 'VA',
      source: 'ip',
    });
  });
});

describe('placeFromLookingFor', () => {
  it('returns the first city place and skips places with no city', () => {
    expect(
      placeFromLookingFor([
        { places: [{ kind: 'zip', state: 'VA' }] },
        { places: [{ kind: 'city', city: 'Arlington', state: 'VA' }] },
      ]),
    ).toEqual({ city: 'Arlington', state: 'VA' });
    expect(placeFromLookingFor([])).toBeNull();
  });
});

describe('roundCoordinate', () => {
  it('rounds to two decimals and keeps the sign (no latitude/longitude swap)', () => {
    expect(roundCoordinate(38.90719)).toBe(38.91);
    expect(roundCoordinate(-77.03687)).toBe(-77.04);
  });
});
