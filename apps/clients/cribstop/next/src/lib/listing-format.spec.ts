import {
  formatClosePrice,
  formatDwellingStats,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouse,
  formatOpenHouseBadge,
  formatStreetAddress,
  hasMapCoordinates,
  PRICE_WITHHELD_COPY,
} from './listing-format';

describe('formatListingPrice', () => {
  it('formats a price', () => {
    expect(formatListingPrice(750000, 'sale')).toEqual({ text: '$750,000', isWithheld: false });
  });

  it('renders the withheld sentence for a null price — never blank, never $0, never an estimate', () => {
    const display = formatListingPrice(null, 'sale');

    expect(display.isWithheld).toBe(true);
    expect(display.text).toBe(PRICE_WITHHELD_COPY);
    expect(display.text).toMatch(/withheld at the seller/i);
    expect(display.text).not.toMatch(/\$/);
    expect(display.text).not.toBe('');
  });

  it('never renders $0 for a withheld price', () => {
    expect(formatListingPrice(null, 'rent').text).not.toMatch(/\$0/);
  });
});

describe('formatClosePrice', () => {
  it('shows what a sold listing actually closed at, with its close date', () => {
    expect(formatClosePrice(690000, '2026-03-14')).toBe('Sold for $690,000 on Mar 14, 2026');
  });

  it('omits the date rather than inventing one when closeDate is null', () => {
    expect(formatClosePrice(690000, null)).toBe('Sold for $690,000');
  });

  it('renders nothing when there is no close price', () => {
    expect(formatClosePrice(null, '2026-03-14')).toBeNull();
  });

  it('does not shift the close date across a timezone boundary', () => {
    // A plain YYYY-MM-DD parsed as a UTC instant renders as the previous day west of UTC.
    expect(formatClosePrice(500000, '2026-01-01')).toContain('Jan 1, 2026');
  });
});

describe('formatDwellingStats', () => {
  it('formats a full triplet', () => {
    expect(formatDwellingStats(3, 2, 1800)).toBe('3 bd · 2 ba · 1,800 sqft');
  });

  it('omits a null part rather than rendering a dash or a zero', () => {
    expect(formatDwellingStats(3, null, 1800)).toBe('3 bd · 1,800 sqft');
    expect(formatDwellingStats(null, null, 1800)).toBe('1,800 sqft');
  });

  it('returns null for a parcel so the caller renders no line at all', () => {
    expect(formatDwellingStats(null, null, null)).toBeNull();
  });

  it('keeps a legitimate zero distinct from a missing value', () => {
    expect(formatDwellingStats(0, 1, null)).toBe('0 bd · 1 ba');
  });

  it('cannot throw on a parcel — the shipped Lot/Land chip used to reach .toLocaleString() on null', () => {
    expect(() => formatDwellingStats(null, null, null)).not.toThrow();
  });
});

describe('formatLotSize', () => {
  it('uses acres above a quarter acre', () => {
    expect(formatLotSize(104544)).toBe('2.4 acres lot');
  });

  it('uses sqft below a quarter acre', () => {
    expect(formatLotSize(10454)).toBe('10,454 sqft lot');
  });

  it('singularises exactly one acre', () => {
    expect(formatLotSize(43560)).toBe('1 acre lot');
  });

  it('rounds to whole acres for large parcels', () => {
    expect(formatLotSize(43560 * 12)).toBe('12 acres lot');
  });

  it('renders nothing when lot size is unknown', () => {
    expect(formatLotSize(null)).toBeNull();
    expect(formatLotSize(0)).toBeNull();
  });
});

describe('formatListingLocation', () => {
  it('prefers the neighbourhood', () => {
    expect(formatListingLocation('Old Town', 'Alexandria', 'VA')).toBe('Old Town, Alexandria');
  });

  it('falls back to city, state — never a bare comma', () => {
    expect(formatListingLocation(null, 'Alexandria', 'VA')).toBe('Alexandria, VA');
    expect(formatListingLocation(null, 'Alexandria', 'VA')).not.toMatch(/^,|,\s*$/);
  });
});

describe('formatStreetAddress', () => {
  it('formats a visible address', () => {
    expect(formatStreetAddress('501 Slaters Ln', 'Alexandria', 'VA', '22314')).toBe(
      '501 Slaters Ln, Alexandria, VA 22314',
    );
  });

  it('returns null for a suppressed address, with no city or ZIP standing in for it', () => {
    expect(formatStreetAddress(null, 'Alexandria', 'VA', '22314')).toBeNull();
  });
});

describe('hasMapCoordinates', () => {
  it('is true only when both coordinates are present', () => {
    expect(hasMapCoordinates({ latitude: 38.8, longitude: -77.0 })).toBe(true);
  });

  it('is false for a suppressed-address row, so no pin and no centroid is produced', () => {
    expect(hasMapCoordinates({ latitude: null, longitude: null })).toBe(false);
    expect(hasMapCoordinates({ latitude: 38.8, longitude: null })).toBe(false);
    expect(hasMapCoordinates({ latitude: null, longitude: -77.0 })).toBe(false);
  });

  it('treats a zero coordinate as a real value, not a missing one', () => {
    expect(hasMapCoordinates({ latitude: 0, longitude: 0 })).toBe(true);
  });
});

describe('formatOpenHouse', () => {
  it('renders the occurrence the API sent', () => {
    const text = formatOpenHouse({
      startsAt: '2026-09-05T15:00:00.000Z',
      endsAt: '2026-09-05T17:00:00.000Z',
      remarks: null,
    });

    expect(text).toMatch(/Sep 5/);
    expect(text).toMatch(/–/);
  });
});

describe('formatOpenHouseBadge', () => {
  it('renders one compact string carrying the day and the range', () => {
    expect(
      formatOpenHouseBadge({
        startsAt: '2026-09-05T13:00:00.000Z',
        endsAt: '2026-09-05T15:00:00.000Z',
        remarks: null,
      }),
    ).toMatch(/^Open Sat \d/);
  });

  it('drops the meridiem from the start when both ends share it', () => {
    // 1pm–3pm reads better than 1pm–3pm spelled out twice, and the badge has little room.
    const text = formatOpenHouseBadge({
      startsAt: '2026-09-05T17:00:00.000Z',
      endsAt: '2026-09-05T19:00:00.000Z',
      remarks: null,
    });
    expect(text.match(/pm/g)).toHaveLength(1);
  });

  it('keeps both when the range crosses midday', () => {
    const text = formatOpenHouseBadge({
      startsAt: '2026-09-05T13:00:00.000Z',
      endsAt: '2026-09-05T17:00:00.000Z',
      remarks: null,
    });
    expect(text).toMatch(/am/);
    expect(text).toMatch(/pm/);
  });

  /*
   * These two pin the *property's* clock rather than the runtime's. Without an explicit
   * `timeZone` the same instant rendered "9am–1pm" on an Eastern dev machine and "1–5pm" in UTC
   * CI: green locally, red on the PR. Asserting the exact string is the point — a looser matcher
   * is what let the drift through in the first place.
   */
  it("renders the property's local hour, not the runtime's", () => {
    expect(
      formatOpenHouseBadge({
        startsAt: '2026-09-05T13:00:00.000Z',
        endsAt: '2026-09-05T17:00:00.000Z',
        remarks: null,
      }),
    ).toBe('Open Sat 9am–1pm');
  });

  it("keeps a late-evening open house on the property's calendar day", () => {
    // 00:00Z Sun Sep 6 is 8pm Sat Sep 5 in Eastern. Rendered in a UTC runtime this open house
    // lands on the wrong *day*, which sends a buyer to the property 24 hours out — a worse
    // failure than the wrong hour, and invisible to any test that only checks for "am"/"pm".
    expect(
      formatOpenHouseBadge({
        startsAt: '2026-09-06T00:00:00.000Z',
        endsAt: '2026-09-06T02:00:00.000Z',
        remarks: null,
      }),
    ).toBe('Open Sat 8–10pm');
  });
});
