import { type ListingStatusLookup } from './status';
import { mapBrightPropertyRecord, type MapContext } from './map-record';

const STATUSES: readonly ListingStatusLookup[] = [
  { code: 'Active', consumerStatus: 'Active', isTerminal: false, resoStandardStatus: 'Active' },
  { code: 'Closed', consumerStatus: 'Sold', isTerminal: true, resoStandardStatus: 'Closed' },
  { code: 'Withdrawn', consumerStatus: null, isTerminal: true, resoStandardStatus: 'Withdrawn' },
];

const BASE_PAYLOAD: Record<string, unknown> = {
  ListingKey: 'BR-1',
  UnparsedAddress: '123 Oak St',
  City: 'Arlington',
  StateOrProvince: 'VA',
  PostalCode: '22201',
  ListPrice: 500000,
  PropertySubType: 'Detached',
  StandardStatus: 'Active',
  ListOfficeName: 'Acme Realty',
  ListOfficePhone: '2025551234',
  ListOfficeEmail: 'office@acme.example',
  ModificationTimestamp: '2026-09-18T00:00:00Z',
};

function ctx(overrides: Partial<MapContext> = {}): MapContext {
  return { feed: 'test', statuses: STATUSES, soldDisplayDelayDays: null, ...overrides };
}

describe('mapBrightPropertyRecord', () => {
  it('maps a complete, active record and sample-marks it on the test feed', () => {
    const result = mapBrightPropertyRecord(BASE_PAYLOAD, ctx());
    expect(result.kind).toBe('mapped');
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.listingKey).toBe('BR-1');
    expect(result.property.property_type).toBe('Single Family');
    expect(result.property.is_sample).toBe(true);
    expect(result.listing.title).toBe('Single Family in Arlington, VA (Sample)');
    expect(result.listing.status).toBe('Active');
    expect(result.listing.consumerStatus).toBe('Active');
    expect(result.listing.isSample).toBe(true);
  });

  it('does not sample-mark a record from the production feed', () => {
    const result = mapBrightPropertyRecord(BASE_PAYLOAD, ctx({ feed: 'production' }));
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.property.is_sample).toBe(false);
    expect(result.listing.title).toBe('Single Family in Arlington, VA');
  });

  it('accepts a numeric ListingKey, which is how it round-trips through jsonb', () => {
    const result = mapBrightPropertyRecord({ ...BASE_PAYLOAD, ListingKey: 650096861206 }, ctx());
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.listingKey).toBe('650096861206');
  });

  it('rejects a record with no ListingKey', () => {
    const { ListingKey, ...rest } = BASE_PAYLOAD;
    void ListingKey;
    expect(mapBrightPropertyRecord(rest, ctx())).toEqual({
      kind: 'rejected',
      listingKey: null,
      reason: 'missing_listing_key',
    });
  });

  it('rejects a record missing the address', () => {
    const { UnparsedAddress, ...rest } = BASE_PAYLOAD;
    void UnparsedAddress;
    expect(mapBrightPropertyRecord(rest, ctx())).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'missing_address',
    });
  });

  it('rejects a record missing the list price', () => {
    const { ListPrice, ...rest } = BASE_PAYLOAD;
    void ListPrice;
    expect(mapBrightPropertyRecord(rest, ctx())).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'missing_price',
    });
  });

  it('rejects an unrecognised property sub type', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, PropertySubType: 'Houseboat' },
      ctx(),
    );
    expect(result).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'unrecognized_property_type',
    });
  });

  it('maps a residential record via StructureDesignType when PropertySubType is blank (#207)', () => {
    const { PropertySubType, ...rest } = BASE_PAYLOAD;
    void PropertySubType;
    const result = mapBrightPropertyRecord(
      { ...rest, PropertyType: 'Residential', StructureDesignType: 'Interior Row/Townhouse' },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.property.property_type).toBe('Townhome');
  });

  it('maps a Residential Lease record to offer_kind rent (#225)', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, PropertyType: 'Residential Lease' },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.listing.offerKind).toBe('rent');
    expect(result.listing.listPrice).toBe(500000);
  });

  it('maps a CommercialLease record to offer_kind rent the same way', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, PropertyType: 'CommercialLease' },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.listing.offerKind).toBe('rent');
  });

  it('maps a non-lease PropertyType to offer_kind sale, including one merely containing "Lease"', () => {
    // A closed-set check, not a substring test: RESO also uses "Lease" in non-rental descriptors
    // (e.g. ground-lease land tenure), which must not be misread as a rental offer.
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, PropertyType: 'Residential Leasehold' },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.listing.offerKind).toBe('sale');
  });

  it('rejects an unrecognised StandardStatus', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, StandardStatus: 'Registered' },
      ctx(),
    );
    expect(result).toEqual({ kind: 'rejected', listingKey: 'BR-1', reason: 'unrecognized_status' });
  });

  it('rejects a record missing required attribution', () => {
    const { ListOfficeName, ...rest } = BASE_PAYLOAD;
    void ListOfficeName;
    expect(mapBrightPropertyRecord(rest, ctx())).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'missing_required_attribution',
    });
  });

  it('rejects a Sold record when the display-delay window is unconfigured', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, StandardStatus: 'Closed', ClosePrice: 495000, CloseDate: '2026-01-01' },
      ctx({ soldDisplayDelayDays: null }),
    );
    expect(result).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'sold_display_delay_not_configured',
    });
  });

  it('rejects a Sold record still inside a configured display-delay window', () => {
    const closeDate = new Date().toISOString().slice(0, 10);
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, StandardStatus: 'Closed', ClosePrice: 495000, CloseDate: closeDate },
      ctx({ soldDisplayDelayDays: 30 }),
    );
    expect(result).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'sold_still_in_display_delay_window',
    });
  });

  it('rejects a Sold record with no CloseDate even once a delay window is configured', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, StandardStatus: 'Closed', ClosePrice: 495000 },
      ctx({ soldDisplayDelayDays: 30 }),
    );
    expect(result).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'sold_missing_close_date',
    });
  });

  it('rejects a Sold record with an unparseable CloseDate rather than publishing with zero delay', () => {
    // A comparison against NaN is always false, so `Date.now() < NaN` must not be read as
    // "the delay window has passed" — this is the failure mode a malformed CloseDate exercises.
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, StandardStatus: 'Closed', ClosePrice: 495000, CloseDate: 'N/A' },
      ctx({ soldDisplayDelayDays: 30 }),
    );
    expect(result).toEqual({
      kind: 'rejected',
      listingKey: 'BR-1',
      reason: 'sold_missing_close_date',
    });
  });

  it('publishes a Sold record once its configured display-delay window has passed', () => {
    const closeDate = '2000-01-01';
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, StandardStatus: 'Closed', ClosePrice: 495000, CloseDate: closeDate },
      ctx({ soldDisplayDelayDays: 30 }),
    );
    expect(result.kind).toBe('mapped');
  });

  it('rounds a fractional LotSizeSquareFeet to fit the integer lot_sqft column (#207)', () => {
    const result = mapBrightPropertyRecord({ ...BASE_PAYLOAD, LotSizeSquareFeet: 127195.2 }, ctx());
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.property.lot_sqft).toBe(127195);
  });

  it('drops a LotSizeSquareFeet that overflows the integer column instead of crashing (#237)', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, LotSizeSquareFeet: 4216172400 },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.property.lot_sqft).toBeNull();
    expect(result.outOfRangeFields).toEqual(['LotSizeSquareFeet']);
  });

  it('drops a negative overflow too, and keeps other fields when only one overflows (#237)', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, LotSizeSquareFeet: -4216172400, BedroomsTotal: 3 },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.property.lot_sqft).toBeNull();
    expect(result.property.beds).toBe(3);
    expect(result.outOfRangeFields).toEqual(['LotSizeSquareFeet']);
  });

  it('keeps outOfRangeFields empty when every numeric field is in range', () => {
    const result = mapBrightPropertyRecord(BASE_PAYLOAD, ctx());
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.outOfRangeFields).toEqual([]);
  });

  it('splits a unit designator out of the address into unitNumber', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, UnparsedAddress: '123 Oak St Unit 4B' },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.unitNumber).toBe('4B');
    expect(result.property.street_line).toBe('123 Oak St');
  });

  it('maps the suppression and attribution fields through unchanged', () => {
    const result = mapBrightPropertyRecord(
      { ...BASE_PAYLOAD, InternetEntireListingDisplayYN: true, InternetAddressDisplayYN: false },
      ctx(),
    );
    if (result.kind !== 'mapped') throw new Error('expected mapped');
    expect(result.listing.suppression.internetDisplayAllowed).toBe(true);
    expect(result.listing.suppression.addressDisplayAllowed).toBe(false);
    expect(result.listing.attribution.officeName).toBe('Acme Realty');
  });

  it('is idempotent: mapping the same payload twice yields identical output', () => {
    const first = mapBrightPropertyRecord(BASE_PAYLOAD, ctx());
    const second = mapBrightPropertyRecord(BASE_PAYLOAD, ctx());
    expect(first).toEqual(second);
  });
});
