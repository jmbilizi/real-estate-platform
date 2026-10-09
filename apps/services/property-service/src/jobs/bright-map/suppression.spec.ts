import {
  mapSuppressionFlags,
  SUPPRESSION_FIELDS_BY_SOURCE,
  UNDECLARED_SUPPRESSION_FIELDS,
} from './suppression';

const FIELDS = SUPPRESSION_FIELDS_BY_SOURCE.BrightMLS;

describe('mapSuppressionFlags', () => {
  it('names the election fields from the #146 ruling, keyed by source system', () => {
    expect(SUPPRESSION_FIELDS_BY_SOURCE).toEqual({
      BrightMLS: {
        price: 'InternetListingDisplayPricesYN',
        priceHistory: 'InternetListingDisplayHistoricalPricesYN',
        daysOnMarket: 'InternetListingDisplayDaysOnSiteYN',
        media: 'MediaInternetDisplayYN',
      },
    });
    expect([...UNDECLARED_SUPPRESSION_FIELDS].sort()).toEqual(Object.values(FIELDS).sort());
  });

  it('shows every value when the record carries no election field', () => {
    expect(
      mapSuppressionFlags({
        InternetEntireListingDisplayYN: true,
        InternetAddressDisplayYN: true,
      }),
    ).toEqual({
      internetDisplayAllowed: true,
      addressDisplayAllowed: true,
      priceDisplayAllowed: true,
      priceHistoryDisplayAllowed: true,
      mediaDisplayAllowed: true,
      daysOnMarketDisplayAllowed: true,
      anomalies: [],
    });
  });

  describe.each([
    ['price', 'priceDisplayAllowed'],
    ['priceHistory', 'priceHistoryDisplayAllowed'],
    ['daysOnMarket', 'daysOnMarketDisplayAllowed'],
  ] as const)('the %s election', (key, flag) => {
    const field = FIELDS[key];
    const others = (['priceDisplayAllowed', 'priceHistoryDisplayAllowed'] as const)
      .concat('daysOnMarketDisplayAllowed' as never)
      .filter((name) => name !== flag);

    it('shows on a literal true', () => {
      const result = mapSuppressionFlags({ [field]: true });
      expect(result[flag]).toBe(true);
      expect(result.anomalies).toEqual([]);
    });

    it('suppresses on a literal false and leaves the other flags alone', () => {
      const result = mapSuppressionFlags({ [field]: false });
      expect(result[flag]).toBe(false);
      expect(result.anomalies).toEqual([]);
      for (const other of others) {
        expect(result[other]).toBe(true);
      }
    });

    it('shows when the field is absent', () => {
      expect(mapSuppressionFlags({})[flag]).toBe(true);
    });

    it('shows when the field is null', () => {
      const result = mapSuppressionFlags({ [field]: null });
      expect(result[flag]).toBe(true);
      expect(result.anomalies).toEqual([]);
    });

    it.each([['Y'], ['false'], ['true'], [0], [1]])(
      'suppresses and counts an anomaly on the non-boolean %p',
      (value) => {
        const result = mapSuppressionFlags({ [field]: value });
        expect(result[flag]).toBe(false);
        expect(result.anomalies).toEqual([key]);
      },
    );
  });

  it('keeps the listing and address gates explicit-true (default deny)', () => {
    expect(mapSuppressionFlags({}).internetDisplayAllowed).toBe(false);
    expect(mapSuppressionFlags({}).addressDisplayAllowed).toBe(false);
    const odd = mapSuppressionFlags({
      InternetEntireListingDisplayYN: 'Y',
      InternetAddressDisplayYN: 1,
    });
    expect(odd.internetDisplayAllowed).toBe(false);
    expect(odd.addressDisplayAllowed).toBe(false);
    expect(odd.anomalies).toEqual([]);
  });

  it('keeps listing-level media allowed whatever the feed sends (ruling 2026-09-22)', () => {
    expect(mapSuppressionFlags({}).mediaDisplayAllowed).toBe(true);
    expect(mapSuppressionFlags({ [FIELDS.media]: false }).mediaDisplayAllowed).toBe(true);
  });
});
