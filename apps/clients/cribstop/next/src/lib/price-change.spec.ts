import {
  CARD_DATE_DAYS,
  describeCardPriceChange,
  describePriceChange,
  formatCardPriceChange,
  formatDetailPriceChange,
  formatPriceChangeAmount,
  MAX_INDICATOR_DAYS,
} from './price-change';

const NOW = Date.UTC(2026, 9, 8, 15, 30);
const daysAgo = (days: number): string => new Date(Date.UTC(2026, 9, 8 - days)).toISOString();

describe('formatPriceChangeAmount (#717)', () => {
  it.each([
    [950, '$950'],
    [999, '$999'],
    [1000, '$1,000'],
    [9500, '$9,500'],
    [9999, '$9,999'],
    [10_000, '$10K'],
    [12_500, '$12.5K'],
    [12_550, '$12.5K'],
    [100_000, '$100K'],
    [999_500, '$999.5K'],
    [999_999, '$999.9K'],
    [1_000_000, '$1M'],
    [1_250_000, '$1.2M'],
    [1_299_999, '$1.2M'],
    [2_000_000, '$2M'],
  ])('writes %i as %s, never above the real amount', (amount, text) => {
    expect(formatPriceChangeAmount(amount)).toBe(text);
  });

  it('reads the size of a change, not its sign', () => {
    expect(formatPriceChangeAmount(-100_000)).toBe('$100K');
  });
});

describe('describePriceChange (#717)', () => {
  const base = { price: 2_197_500, previousPrice: 2_297_500, priceChangedAt: daysAgo(3) };

  it('describes a cut with two stored prices', () => {
    const change = describePriceChange(base, NOW);
    expect(change).toMatchObject({
      direction: 'down',
      amountText: '$100K',
      fullAmountText: '$100,000',
      percentText: '4.4%',
      previousPriceText: '$2,297,500',
      dateText: 'Oct 5',
    });
  });

  it('describes an increase with the same shape', () => {
    const change = describePriceChange({ ...base, price: 2_397_500 }, NOW);
    expect(change).toMatchObject({ direction: 'up', amountText: '$100K', percentText: '4.4%' });
  });

  it('shows nothing when no earlier price exists, or an older service sent none', () => {
    expect(describePriceChange({ price: 500_000 }, NOW)).toBeNull();
    expect(describePriceChange({ ...base, previousPrice: null }, NOW)).toBeNull();
    expect(describePriceChange({ ...base, priceChangedAt: null }, NOW)).toBeNull();
  });

  it('shows nothing for a withheld price, a sold row or an unchanged price', () => {
    expect(describePriceChange({ ...base, price: null }, NOW)).toBeNull();
    expect(describePriceChange({ ...base, listingType: 'sold' }, NOW)).toBeNull();
    expect(describePriceChange({ ...base, previousPrice: base.price }, NOW)).toBeNull();
  });

  it(`shows nothing for a change older than ${MAX_INDICATOR_DAYS} days`, () => {
    expect(describePriceChange({ ...base, priceChangedAt: daysAgo(90) }, NOW)).not.toBeNull();
    expect(describePriceChange({ ...base, priceChangedAt: daysAgo(91) }, NOW)).toBeNull();
  });
});

describe('card text (#717)', () => {
  const at = (days: number, price = 2_197_500) =>
    describePriceChange(
      { price, previousPrice: 2_297_500, priceChangedAt: daysAgo(days) },
      NOW,
    ) as NonNullable<ReturnType<typeof describePriceChange>>;

  it(`names the day only inside ${CARD_DATE_DAYS} days`, () => {
    expect(formatCardPriceChange(at(6))).toBe('↓ $100K · Oct 2');
    expect(formatCardPriceChange(at(CARD_DATE_DAYS))).toContain('·');
    expect(formatCardPriceChange(at(CARD_DATE_DAYS + 1))).toBe('↓ $100K');
  });

  it('gives a cut and an increase the same text shape, with an arrow and an amount', () => {
    expect(formatCardPriceChange(at(30, 2_397_500))).toBe('↑ $100K');
    expect(formatCardPriceChange(at(30))).toBe('↓ $100K');
  });

  it('gives the full amount to a screen reader', () => {
    expect(describeCardPriceChange(at(30))).toBe('Price reduced by $100,000');
    expect(describeCardPriceChange(at(30, 2_397_500))).toBe('Price increased by $100,000');
    expect(describeCardPriceChange(at(6))).toBe('Price reduced by $100,000, Oct 2');
  });

  it('writes the detail line from the two stored prices', () => {
    expect(formatDetailPriceChange(at(6))).toBe('Reduced $100,000 (4.4%) from $2,297,500 on Oct 2');
    expect(formatDetailPriceChange(at(6, 2_397_500))).toBe(
      'Increased $100,000 (4.4%) from $2,297,500 on Oct 2',
    );
  });
});
