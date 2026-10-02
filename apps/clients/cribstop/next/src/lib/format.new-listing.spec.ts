import { formatNewListingBadge } from './format';

describe('formatNewListingBadge (#542)', () => {
  const now = new Date('2026-10-15T12:00:00.000Z').getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('uses minutes and hours from the precise instant', () => {
    expect(formatNewListingBadge('2026-10-15T00:00:00.000Z', now, at(12 * 60_000))).toBe(
      'New · 12 min ago',
    );
    expect(formatNewListingBadge('2026-10-15T00:00:00.000Z', now, at(3 * 3_600_000))).toBe(
      'New · 3 hr ago',
    );
  });

  it('never invents a time from a date-only value', () => {
    expect(formatNewListingBadge('2026-10-15T00:00:00.000Z', now)).toBe('New · Today');
  });

  it('uses singular and plural days, and ends at 7 days', () => {
    expect(formatNewListingBadge('2026-10-14T00:00:00.000Z', now)).toBe('New · 1 day ago');
    expect(formatNewListingBadge('2026-10-09T00:00:00.000Z', now)).toBe('New · 6 days ago');
    expect(formatNewListingBadge('2026-10-08T00:00:00.000Z', now)).toBeNull();
  });

  it('is null when the age is unknown', () => {
    expect(formatNewListingBadge(null, now)).toBeNull();
    expect(formatNewListingBadge('nope', now)).toBeNull();
  });
});
