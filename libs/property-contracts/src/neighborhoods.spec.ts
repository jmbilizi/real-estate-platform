import {
  neighborhoodRowSchema,
  neighborhoodsRequestSchema,
  neighborhoodsResponseSchema,
} from './neighborhoods';

describe('neighborhoodsRequestSchema', () => {
  it('defaults listingType, minCount and limit when omitted', () => {
    const parsed = neighborhoodsRequestSchema.parse({});
    expect(parsed).toEqual({ listingType: 'all', minCount: 3, limit: 24 });
  });

  it('accepts sale and rent, rejects sold', () => {
    expect(neighborhoodsRequestSchema.safeParse({ listingType: 'sale' }).success).toBe(true);
    expect(neighborhoodsRequestSchema.safeParse({ listingType: 'rent' }).success).toBe(true);
    expect(neighborhoodsRequestSchema.safeParse({ listingType: 'sold' }).success).toBe(false);
  });

  it('rejects a state code that is not two letters', () => {
    expect(neighborhoodsRequestSchema.safeParse({ state: 'MDD' }).success).toBe(false);
  });

  it('rejects an unknown query parameter', () => {
    expect(neighborhoodsRequestSchema.safeParse({ neighborhood: 'Fishtown' }).success).toBe(false);
  });

  it('bounds minCount to 1..1000 and limit to 1..100', () => {
    expect(neighborhoodsRequestSchema.safeParse({ minCount: '0' }).success).toBe(false);
    expect(neighborhoodsRequestSchema.safeParse({ minCount: '1001' }).success).toBe(false);
    expect(neighborhoodsRequestSchema.safeParse({ minCount: '1000' }).success).toBe(true);
    expect(neighborhoodsRequestSchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(neighborhoodsRequestSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(neighborhoodsRequestSchema.safeParse({ limit: '100' }).success).toBe(true);
  });

  it('accepts an exact slug filter', () => {
    const parsed = neighborhoodsRequestSchema.parse({ slug: 'fishtown' });
    expect(parsed.slug).toBe('fishtown');
  });
});

describe('neighborhoodsResponseSchema', () => {
  it('parses an empty result set', () => {
    const parsed = neighborhoodsResponseSchema.parse({ results: [], total: 0 });
    expect(parsed.results).toEqual([]);
  });

  it('parses a row with only counts and identity, no ranking field', () => {
    const row = {
      name: 'Fishtown',
      city: 'Philadelphia',
      state: 'PA',
      slug: 'fishtown',
      total: 42,
      sale: 30,
      rent: 12,
    };
    const parsed = neighborhoodsResponseSchema.parse({ results: [row], total: 1 });
    expect(parsed.results[0]).toEqual(row);
  });

  describe('previewPhotos (#486)', () => {
    const base = {
      name: 'Fishtown',
      city: 'Philadelphia',
      state: 'PA',
      slug: 'fishtown',
      total: 42,
      sale: 30,
      rent: 12,
    };
    const photo = (n: number) => ({ url: 'https://cdn.example/' + n + '.jpg', listingId: 'l' + n });

    it.each([0, 1, 3, 5])('accepts %i photos', (count) => {
      const previewPhotos = Array.from({ length: count }, (_, i) => photo(i));
      expect(neighborhoodRowSchema.safeParse({ ...base, previewPhotos }).success).toBe(true);
    });

    it('accepts an absent field', () => {
      expect(neighborhoodRowSchema.safeParse(base).success).toBe(true);
    });

    it('rejects more than 5 photos', () => {
      const previewPhotos = Array.from({ length: 6 }, (_, i) => photo(i));
      expect(neighborhoodRowSchema.safeParse({ ...base, previewPhotos }).success).toBe(false);
    });

    it('rejects a photo without a listingId', () => {
      expect(
        neighborhoodRowSchema.safeParse({ ...base, previewPhotos: [{ url: 'https://x/y.jpg' }] })
          .success,
      ).toBe(false);
    });
  });
});
