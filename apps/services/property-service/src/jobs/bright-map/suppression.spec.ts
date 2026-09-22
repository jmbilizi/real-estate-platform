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
      // Stakeholder ruling 2026-09-22 (#191): media display is allowed for every Bright row.
      mediaDisplayAllowed: true,
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

  it('holds price, price history and days on market suppressed, whatever the feed sends', () => {
    const result = mapSuppressionFlags({
      PriceDisplayYN: true,
      PriceHistoryDisplayYN: true,
      DaysOnMarketDisplayYN: true,
    });
    expect(result.priceDisplayAllowed).toBe(false);
    expect(result.priceHistoryDisplayAllowed).toBe(false);
    expect(result.daysOnMarketDisplayAllowed).toBe(false);
  });

  /**
   * The ruling covers media and nothing else. This test is the guard against widening it: a change
   * that lifts a second flag has to delete an assertion here, which a reviewer sees.
   */
  it('keeps the media ruling narrow — the other three #146 flags stay fail-closed', () => {
    const { priceDisplayAllowed, priceHistoryDisplayAllowed, daysOnMarketDisplayAllowed } =
      mapSuppressionFlags({ InternetEntireListingDisplayYN: true });
    expect([priceDisplayAllowed, priceHistoryDisplayAllowed, daysOnMarketDisplayAllowed]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('allows media display on every Bright row (stakeholder ruling 2026-09-22, #191)', () => {
    // Unconditional, so an empty payload and a payload with a media-shaped field agree. No Bright
    // field is read for this flag, which is the point: the licence is the source, not the feed.
    expect(mapSuppressionFlags({}).mediaDisplayAllowed).toBe(true);
    expect(mapSuppressionFlags({ MediaDisplayYN: false }).mediaDisplayAllowed).toBe(true);
  });
});
