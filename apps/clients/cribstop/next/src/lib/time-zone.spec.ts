import { formatDate, formatDateTime } from './format';
import {
  listingTimeZone,
  PROPERTY_TIME_ZONE,
  STATE_TIME_ZONES,
  timeZoneForState,
} from './time-zone';

const US_STATES_AND_DC =
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  );

describe('timeZoneForState (#79)', () => {
  it('has a valid IANA zone for every state and DC', () => {
    for (const state of US_STATES_AND_DC) {
      const zone = STATE_TIME_ZONES[state];
      expect(zone).toBeDefined();
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
    }
  });

  it('maps states in each US zone', () => {
    expect(timeZoneForState('CA')).toBe('America/Los_Angeles');
    expect(timeZoneForState('WA')).toBe('America/Los_Angeles');
    expect(timeZoneForState('CO')).toBe('America/Denver');
    expect(timeZoneForState('AZ')).toBe('America/Phoenix');
    expect(timeZoneForState('TX')).toBe('America/Chicago');
    expect(timeZoneForState('DC')).toBe('America/New_York');
    expect(timeZoneForState('HI')).toBe('Pacific/Honolulu');
    expect(timeZoneForState('AK')).toBe('America/Anchorage');
  });

  it('accepts lowercase and padded input', () => {
    expect(timeZoneForState(' ca ')).toBe('America/Los_Angeles');
  });

  it('falls back when the row has no state or an unknown one', () => {
    expect(timeZoneForState(undefined)).toBe(PROPERTY_TIME_ZONE);
    expect(timeZoneForState(null)).toBe(PROPERTY_TIME_ZONE);
    expect(timeZoneForState('')).toBe(PROPERTY_TIME_ZONE);
    expect(timeZoneForState('ZZ')).toBe(PROPERTY_TIME_ZONE);
  });
});

describe('date formatters take the listing zone (#79)', () => {
  // 03:30Z on Sep 6 is 8:30pm Sep 5 in Pacific and 11:30pm Sep 5 in Eastern.
  const iso = '2026-09-06T03:30:00.000Z';

  it('formatDate keeps the property calendar day in a Pacific zone', () => {
    expect(formatDate(iso, timeZoneForState('CA'))).toBe('Sep 5, 2026');
  });

  it('formatDateTime renders Pacific time in a Pacific zone', () => {
    expect(formatDateTime(iso, timeZoneForState('CA'))).toBe('Sep 5, 2026, 8:30 PM');
  });

  it('uses the fallback zone when no zone is passed', () => {
    expect(formatDateTime(iso)).toBe('Sep 5, 2026, 11:30 PM');
  });
});

describe('listingTimeZone (#983)', () => {
  const iso = '2026-09-06T02:30:00.000Z';

  it('renders an El Paso listing in Mountain time, not the Texas state zone', () => {
    const elPaso = { state: 'TX', timeZone: 'America/Denver' };
    expect(listingTimeZone(elPaso)).toBe('America/Denver');
    expect(formatDateTime(iso, listingTimeZone(elPaso))).toBe('Sep 5, 2026, 8:30 PM');
    expect(formatDateTime(iso, listingTimeZone({ state: 'TX' }))).toBe('Sep 5, 2026, 9:30 PM');
  });

  it('uses the contract zone before the state table', () => {
    expect(listingTimeZone({ state: 'FL', timeZone: 'America/Chicago' })).toBe('America/Chicago');
  });

  it('uses the state table when the contract has no zone', () => {
    expect(listingTimeZone({ state: 'CA' })).toBe('America/Los_Angeles');
    expect(listingTimeZone({ state: 'CA', timeZone: null })).toBe('America/Los_Angeles');
    expect(listingTimeZone({ state: 'CA', timeZone: '  ' })).toBe('America/Los_Angeles');
  });

  it('ignores a zone the runtime does not know', () => {
    expect(listingTimeZone({ state: 'CA', timeZone: 'Mars/Olympus' })).toBe('America/Los_Angeles');
  });

  it('falls back to the default zone with no zone and no known state', () => {
    expect(listingTimeZone({})).toBe(PROPERTY_TIME_ZONE);
    expect(listingTimeZone({ state: 'ZZ' })).toBe(PROPERTY_TIME_ZONE);
  });
});
