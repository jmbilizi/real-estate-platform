import { listingCardSchema, listingDetailSchema } from '@cribstop/property-contracts';
import { aLandParcelRow, aListingCardRow, aListingDetail, aSuppressedAddressRow } from './fixtures';

/**
 * The fixtures every other spec builds on are parsed by the same schemas the service validates
 * against. Without this, a contract change would leave the UI specs passing against a shape the
 * API no longer sends — the specs would still be green and the app still broken.
 */
describe('test fixtures conform to the wire contract', () => {
  it('builds a valid card row', () => {
    expect(listingCardSchema.safeParse(aListingCardRow()).success).toBe(true);
  });

  it('builds a valid land parcel with no dwelling stats', () => {
    const parcel = aLandParcelRow();
    expect(listingCardSchema.safeParse(parcel).success).toBe(true);
    expect(parcel.beds).toBeNull();
    expect(parcel.baths).toBeNull();
    expect(parcel.sqft).toBeNull();
  });

  it('builds a valid suppressed-address row with address and both coordinates null together', () => {
    const row = aSuppressedAddressRow();
    expect(listingCardSchema.safeParse(row).success).toBe(true);
    expect(row.address).toBeNull();
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
  });

  it('builds a valid detail graph, defaulting to the non-subdivided (unit === null) case', () => {
    const detail = aListingDetail();
    expect(listingDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.unit).toBeNull();
  });

  it('builds a valid detail graph for a subdivided building', () => {
    const detail = aListingDetail({
      unit: {
        id: '55555555-5555-4555-8555-555555555555',
        unitNumber: 'PH1',
        beds: 2,
        baths: 2,
        sqft: 1400,
      },
    });
    expect(listingDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('never puts description on a card row — it is detail-only', () => {
    expect('description' in aListingCardRow()).toBe(false);
  });
});
