import { mapSuppressionFlags } from './suppression';

describe('mapSuppressionFlags', () => {
  it('allows display only on an explicit true', () => {
    expect(
      mapSuppressionFlags({
        InternetEntireListingDisplayYN: true,
        InternetAddressDisplayYN: true,
      }),
    ).toEqual({
      internetDisplayAllowed: true,
      addressDisplayAllowed: true,
      priceDisplayAllowed: false,
      priceHistoryDisplayAllowed: false,
      mediaDisplayAllowed: false,
      daysOnMarketDisplayAllowed: false,
    });
  });

  it('suppresses on an explicit false', () => {
    const result = mapSuppressionFlags({
      InternetEntireListingDisplayYN: false,
      InternetAddressDisplayYN: false,
    });
    expect(result.internetDisplayAllowed).toBe(false);
    expect(result.addressDisplayAllowed).toBe(false);
  });

  it('fails closed when the fields are absent', () => {
    const result = mapSuppressionFlags({});
    expect(result.internetDisplayAllowed).toBe(false);
    expect(result.addressDisplayAllowed).toBe(false);
  });

  it('fails closed on a value that is not literally true, e.g. a "Y" string', () => {
    const result = mapSuppressionFlags({
      InternetEntireListingDisplayYN: 'Y',
      InternetAddressDisplayYN: 1,
    });
    expect(result.internetDisplayAllowed).toBe(false);
    expect(result.addressDisplayAllowed).toBe(false);
  });

  it('never maps the #53 flags from any Bright field, per the #146 block', () => {
    const result = mapSuppressionFlags({
      PriceDisplayYN: true,
      PriceHistoryDisplayYN: true,
      MediaDisplayYN: true,
      DaysOnMarketDisplayYN: true,
    });
    expect(result.priceDisplayAllowed).toBe(false);
    expect(result.priceHistoryDisplayAllowed).toBe(false);
    expect(result.mediaDisplayAllowed).toBe(false);
    expect(result.daysOnMarketDisplayAllowed).toBe(false);
  });
});
