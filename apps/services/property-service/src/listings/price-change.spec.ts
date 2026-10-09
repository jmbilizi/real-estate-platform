import { priceChangeLateral, RELIST_WINDOW_DAYS } from './price-change';
import { sameHomeConditions, VIEW_SUBJECT } from './collapse';

/**
 * The behaviour needs a database. `tests/listings-price-change.e2e.spec.ts` covers it. These tests
 * guard the SQL text the unit suite can see.
 */

describe('priceChangeLateral', () => {
  const sql = priceChangeLateral();

  it('reads only stored MLS prices: price_change rows and the earlier record list_price', () => {
    expect(sql).toContain("e.event_type = 'price_change'");
    expect(sql).toContain('e.old_price');
    expect(sql).toContain('pr.list_price');
    expect(sql).not.toMatch(/avg\(|estimate|zestimate/i);
  });

  it('prefers the same key over a relist predecessor', () => {
    expect(sql.indexOf('sk.id IS NOT NULL')).toBeLessThan(sql.indexOf('pr.list_price <>'));
  });

  it('honors the seller suppression of the price and of its history, on both records', () => {
    expect(sql).toContain('l.price_display_allowed AND l.price_history_display_allowed');
    expect(sql).toContain('o.price_history_display_allowed');
    expect(sql).toContain('o.price_display_allowed');
  });

  it('bounds the relist at 60 days before the shown list date', () => {
    expect(RELIST_WINDOW_DAYS).toBe(60);
    expect(sql).toContain("interval '60 days'");
  });

  it('judges only an earlier record of the same home, office and listing type', () => {
    expect(sql).toContain('o.listed_at < v.listed_at');
    expect(sql).toContain('o.office_name = v.office_name');
    expect(sql).toContain('o.listing_type = v.listing_type');
  });

  it('adds no history column unless asked, and never names street_line (#48)', () => {
    expect(sql).not.toContain('AS price_history');
    expect(priceChangeLateral(true)).toContain('AS price_history');
    expect(priceChangeLateral(true)).not.toContain('street_line');
  });

  it('does not add a bind parameter', () => {
    expect(priceChangeLateral(true)).not.toMatch(/\$\d/);
  });
});

describe('sameHomeConditions', () => {
  it('requires both records live by default, and only internet display for an ended record', () => {
    expect(sameHomeConditions(VIEW_SUBJECT).join('\n')).toContain('o.consumer_status IN');
    const ended = sameHomeConditions(VIEW_SUBJECT, false).join('\n');
    expect(ended).not.toContain('o.consumer_status IN');
    expect(ended).toContain('o.internet_display_allowed');
  });
});
