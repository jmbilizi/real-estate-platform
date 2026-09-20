import { formatEffectiveDate } from './legal-content';

describe('formatEffectiveDate', () => {
  it('returns a pending note when the date is null', () => {
    expect(formatEffectiveDate(null)).toBe('Pending legal approval');
  });

  it('formats a valid ISO date', () => {
    expect(formatEffectiveDate('2026-04-20')).toBe('April 20, 2026');
  });

  it('returns a pending note rather than "Invalid Date" for a malformed value', () => {
    expect(formatEffectiveDate('2026-13-40')).toBe('Pending legal approval');
    expect(formatEffectiveDate('not-a-date')).toBe('Pending legal approval');
  });

  it('returns a pending note for a calendar-invalid date instead of silently rolling it over', () => {
    // `new Date('2026-02-30T00:00:00Z')` rolls over to March 2, 2026 rather than failing.
    expect(formatEffectiveDate('2026-02-30')).toBe('Pending legal approval');
    expect(formatEffectiveDate('2026-04-31')).toBe('Pending legal approval');
  });
});
