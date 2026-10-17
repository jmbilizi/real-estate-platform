import { thinPageMinListings } from './seo-config';
import {
  cityRobots,
  type CityStats,
  citySummary,
  cityTitle,
  medianFromRanks,
} from './city-summary';

const stats: CityStats = {
  activeCount: 42,
  medianPrice: 525000,
  asOf: '2026-10-14T12:00:00.000Z',
  sources: ['brightMLS'],
};

describe('medianFromRanks (#842)', () => {
  it('is null with no priced listing', () => {
    expect(medianFromRanks(0)).toBeNull();
  });
  it('reads one rank for an odd count', () => {
    expect(medianFromRanks(5)).toEqual([3]);
  });
  it('reads two ranks for an even count', () => {
    expect(medianFromRanks(4)).toEqual([2, 3]);
  });
});

describe('thinPageMinListings (#842)', () => {
  it('defaults to 10', () => expect(thinPageMinListings({})).toBe(10));
  it('reads the config', () => {
    expect(thinPageMinListings({ THIN_PAGE_MIN_LISTINGS: '25' } as never)).toBe(25);
  });
  it('ignores a bad value', () => {
    expect(thinPageMinListings({ THIN_PAGE_MIN_LISTINGS: 'x' } as never)).toBe(10);
  });
});

describe('cityRobots (#842)', () => {
  it('indexes a page at the threshold', () => {
    expect(cityRobots(10, 10)).toEqual({ index: true, follow: true });
  });
  it('noindexes a thin page and keeps follow', () => {
    expect(cityRobots(9, 10)).toEqual({ index: false, follow: true });
  });
  it('noindexes when the count is unknown', () => {
    expect(cityRobots(null, 10)).toEqual({ index: false, follow: true });
  });
});

describe('citySummary (#842)', () => {
  it('states count, median, date and source, in 2 to 3 sentences', () => {
    const text = citySummary('Alexandria, VA', 'homes-for-sale', stats);
    expect(text).toContain('42 active listings');
    expect(text).toContain('$525,000');
    expect(text).toContain('Oct 14, 2026');
    expect(text).toContain('Bright MLS');
    expect(text.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(3);
  });
  it('says rent for a rental path', () => {
    expect(citySummary('Alexandria, VA', 'homes-for-rent', stats)).toContain('median list rent');
  });
  it('omits the median when no price is published', () => {
    const text = citySummary('Alexandria, VA', 'homes-for-sale', { ...stats, medianPrice: null });
    expect(text).not.toContain('median');
    expect(text).toContain('42 active listings');
  });
  it('uses the singular for one listing', () => {
    expect(citySummary('X, VA', 'homes-for-sale', { ...stats, activeCount: 1 })).toContain(
      '1 active listing for sale',
    );
  });
  it('makes no claim about people, schools, safety or fit', () => {
    const text = citySummary('Alexandria, VA', 'homes-for-sale', stats);
    expect(text).not.toMatch(/resident|school|safe|crime|good for|famil|neighbo|sold/i);
  });
});

describe('cityTitle (#842)', () => {
  it('names the place and the brokerage', () => {
    expect(cityTitle('Alexandria, VA', 'homes-for-rent')).toBe(
      'Homes for rent in Alexandria, VA · Real Broker, LLC',
    );
  });
});
