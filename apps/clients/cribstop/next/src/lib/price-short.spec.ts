import { formatPriceShort } from './format';
import { formatListingPrice, formatListingPriceShort } from './listing-format';

describe('formatPriceShort (#546)', () => {
  it.each([
    [585_000, 'sale', '$585K'],
    [2_100_000, 'sale', '$2.1M'],
    [2_000_000, 'sale', '$2M'],
    [1_250_000, 'sold', '$1.25M'],
    [999_600, 'sale', '$1M'],
    [999_400, 'sale', '$999K'],
    [2100, 'rent', '$2.1K/mo'],
    [3000, 'rent', '$3K/mo'],
    [12_500, 'rent', '$13K/mo'],
    [950, 'rent', '$950/mo'],
  ] as const)('%d %s reads %s', (price, type, text) => {
    expect(formatPriceShort(price, type)).toBe(text);
  });
});

describe('formatListingPriceShort (#546)', () => {
  it('withholds exactly where the card withholds, and never prints $0', () => {
    for (const type of ['sale', 'rent', 'sold'] as const) {
      const card = formatListingPrice(null, type);
      const pill = formatListingPriceShort(null, type);
      expect(pill.isWithheld).toBe(card.isWithheld);
      expect(pill.text).not.toMatch(/\$/);
    }
  });

  const expand = (text: string): number => {
    const match = /^\$([\d.,]+)([KM]?)/.exec(text);
    if (!match) throw new Error(`not a price: ${text}`);
    const unit = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1000 : 1;
    return Number(match[1].replace(/,/g, '')) * unit;
  };

  it.each([
    [585_000, 'sale'],
    [2_100_000, 'sale'],
    [4_200_000, 'sold'],
    [2100, 'rent'],
    [950, 'rent'],
  ] as const)('%d %s is the card figure, shortened and never changed', (price, type) => {
    const card = formatListingPrice(price, type).text;
    const pill = formatListingPriceShort(price, type).text;
    // The pill reads back to the card price within the rounding of its own unit.
    expect(Math.abs(expand(pill) - expand(card))).toBeLessThanOrEqual(expand(card) * 0.005);
    expect(pill.endsWith('/mo')).toBe(card.endsWith('/mo'));
  });
});
