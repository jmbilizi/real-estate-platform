import { savedHomeSchema, savedHomesRequestSchema } from './saved-homes';
import { listingCardSchema } from './listing-card';

describe('saved homes contract (#23)', () => {
  it('defaults the page and rejects an unknown parameter', () => {
    expect(savedHomesRequestSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(savedHomesRequestSchema.safeParse({ fields: 'id' }).success).toBe(false);
    expect(savedHomesRequestSchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('allows a saved home with no listing', () => {
    const parsed = savedHomeSchema.safeParse({
      propertyId: '0190a000-0000-7000-8000-000000000001',
      savedAt: '2026-10-04T12:00:00.000Z',
      savedFromListingId: null,
      marketStatus: 'Off market',
      canonicalPath: null,
      property: {
        address: null,
        unitNumber: null,
        city: 'Frederick',
        state: 'MD',
        zip: '21701',
        neighborhood: null,
        propertyType: 'Single Family',
        beds: null,
        baths: null,
        sqft: null,
        lotSqft: null,
        yearBuilt: null,
        isSample: false,
      },
      listing: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps the saved flags optional on a card, so an anonymous card omits them', () => {
    const shape = listingCardSchema.shape;
    expect(shape.isSaved.safeParse(undefined).success).toBe(true);
    expect(shape.isFavorited.safeParse(undefined).success).toBe(true);
  });
});
