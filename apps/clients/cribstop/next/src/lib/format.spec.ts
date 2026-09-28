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

  it('reads years once past the 11-month bucket', () => {
    expect(formatTimeOnMarket('2025-10-15T00:00:00.000Z', now)).toBe('1y');
    expect(formatTimeOnMarket('2024-10-15T00:00:00.000Z', now)).toBe('2y');
  });
});
