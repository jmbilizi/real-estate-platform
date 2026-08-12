import { types } from 'pg';

// The parsers are registered as a module side effect, so the import IS the setup. Nothing here
// opens a connection — `getPool()` is never called, so no DATABASE_URL is required.
import './pool';

describe('pg type parsers', () => {
  it('parses every numeric width to a number, including baths_display numeric(4,1)', () => {
    // One parser covers the NUMERIC type regardless of precision/scale, so `list_price`
    // numeric(14,2) and `baths_display` numeric(4,1) are both handled. Without it, sorting a
    // string price is lexicographic ('900000' > '1295000') with no type error anywhere.
    const parse = types.getTypeParser(types.builtins.NUMERIC);

    expect(parse('1295000.00')).toBe(1295000);
    expect(parse('2.5')).toBe(2.5);
    expect(parse('0.0')).toBe(0);
  });

  it('leaves date as the calendar string the contract publishes, never a Date', () => {
    // `listings.close_date` is `date`, and the contract declares `closeDate` as `z.iso.date()`
    // (YYYY-MM-DD). pg's DEFAULT parser returns a JS Date at LOCAL midnight, which fails in two
    // ways at once: JSON.stringify emits a full datetime the contract rejects, and in any timezone
    // west of UTC the instant lands on the previous calendar day — so a sale would publish as
    // having closed a day earlier than it did.
    const parse = types.getTypeParser(types.builtins.DATE);

    expect(parse('2026-01-05')).toBe('2026-01-05');
    expect(typeof parse('2026-01-05')).toBe('string');
  });

  it('does not turn a timestamptz into a string — that one stays a Date the mapper formats', () => {
    // Guards against over-reaching: `last_updated` is timestamptz and genuinely is an instant, so
    // it must keep the default Date parsing. The row mappers call .toISOString() on it.
    expect(
      types.getTypeParser(types.builtins.TIMESTAMPTZ)('2026-04-18 10:30:00+00'),
    ).toBeInstanceOf(Date);
  });
});
