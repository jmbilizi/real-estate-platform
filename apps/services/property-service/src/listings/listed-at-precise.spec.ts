import { derivePreciseListedAt } from './listed-at-precise';

describe('derivePreciseListedAt', () => {
  const listedAt = '2026-09-22T00:00:00.000Z';

  it('returns the instant for a same-day status change with a real time', () => {
    expect(derivePreciseListedAt(listedAt, '2026-09-22T04:16:22Z')).toBe(
      '2026-09-22T04:16:22.000Z',
    );
  });

  it('uses the New York calendar date, not the UTC date', () => {
    // 2026-09-23T02:30Z is 22:30 on 2026-09-22 in New York (EDT).
    expect(derivePreciseListedAt(listedAt, '2026-09-23T02:30:00Z')).toBe(
      '2026-09-23T02:30:00.000Z',
    );
  });

  it('returns null for exactly local midnight (date only), in EST and EDT', () => {
    expect(derivePreciseListedAt('2025-12-05T00:00:00.000Z', '2025-12-05T05:00:00Z')).toBeNull();
    expect(derivePreciseListedAt(listedAt, '2026-09-22T04:00:00Z')).toBeNull();
  });

  it('returns null for a later status change on another date', () => {
    expect(derivePreciseListedAt('2025-01-10T00:00:00.000Z', '2026-09-22T04:16:22Z')).toBeNull();
  });

  it('returns null when either input is null or invalid', () => {
    expect(derivePreciseListedAt(null, '2026-09-22T04:16:22Z')).toBeNull();
    expect(derivePreciseListedAt(listedAt, null)).toBeNull();
    expect(derivePreciseListedAt(listedAt, 'nope')).toBeNull();
  });
});
