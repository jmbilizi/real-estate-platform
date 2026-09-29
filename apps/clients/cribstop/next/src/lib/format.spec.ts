import { formatTimeOnMarket } from './format';

describe('formatTimeOnMarket (#433)', () => {
  const now = new Date('2026-10-15T12:00:00.000Z').getTime();

  it('returns null when listedAt is unknown', () => {
    expect(formatTimeOnMarket(null, now)).toBeNull();
  });

  it('returns null for an unparseable listedAt, rather than a garbage bucket', () => {
    expect(formatTimeOnMarket('not-a-date', now)).toBeNull();
  });

  it('reads "today" for a listing dated today', () => {
    expect(formatTimeOnMarket('2026-10-15T00:00:00.000Z', now)).toBe('today');
  });

  it.each([
    ['2026-10-14T00:00:00.000Z', '1d'],
    ['2026-10-09T00:00:00.000Z', '6d'],
  ])('reads days for %s -> %s', (listedAt, expected) => {
    expect(formatTimeOnMarket(listedAt, now)).toBe(expected);
  });

  it.each([
    ['2026-10-08T00:00:00.000Z', '1w'],
    ['2026-09-17T00:00:00.000Z', '4w'],
  ])('reads weeks for %s -> %s', (listedAt, expected) => {
    expect(formatTimeOnMarket(listedAt, now)).toBe(expected);
  });

  it.each([
    ['2026-09-15T00:00:00.000Z', '1mo'],
    ['2025-11-15T00:00:00.000Z', '11mo'],
  ])('reads months for %s -> %s', (listedAt, expected) => {
    expect(formatTimeOnMarket(listedAt, now)).toBe(expected);
  });

  describe('precise list instant (#459)', () => {
    const listedAt = '2026-10-15T00:00:00.000Z';
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();

    it.each([
      [5 * 60_000, '5 min'],
      [59 * 60_000, '59 min'],
      [60 * 60_000, '1 hr'],
      [3 * 3_600_000 + 20 * 60_000, '3 hr'],
      [23 * 3_600_000 + 59 * 60_000, '23 hr'],
    ])('reads %i ms ago as %s', (msAgo, expected) => {
      expect(formatTimeOnMarket(listedAt, now, at(msAgo))).toBe(expected);
    });

    it('falls back to the day buckets at 24 hours or more', () => {
      expect(formatTimeOnMarket(listedAt, now, at(24 * 3_600_000))).toBe('today');
      expect(formatTimeOnMarket('2026-10-13T00:00:00.000Z', now, at(48 * 3_600_000))).toBe('2d');
    });

    it('falls back when the instant is null or unparseable', () => {
      expect(formatTimeOnMarket(listedAt, now, null)).toBe('today');
      expect(formatTimeOnMarket(listedAt, now, 'nope')).toBe('today');
    });

    it('shows at least 1 min for an instant at or after now', () => {
      expect(formatTimeOnMarket(listedAt, now, at(-30_000))).toBe('1 min');
    });
  });

  it('reads years once past the 11-month bucket', () => {
    expect(formatTimeOnMarket('2025-10-15T00:00:00.000Z', now)).toBe('1y');
    expect(formatTimeOnMarket('2024-10-15T00:00:00.000Z', now)).toBe('2y');
  });
});
