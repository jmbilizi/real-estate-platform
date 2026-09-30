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

describe('neighborhoodsRequestSchema place (#488)', () => {
  const parse = (query: Record<string, unknown>) => neighborhoodsRequestSchema.safeParse(query);

  it('parses one occurrence as a one-item list and normalizes case', () => {
    const parsed = neighborhoodsRequestSchema.parse({ place: 'Bethesda, md' });
    expect(parsed.place).toEqual([{ city: 'Bethesda', state: 'MD' }]);
  });

  it('parses repeated places, keeping the comma inside each item', () => {
    const parsed = neighborhoodsRequestSchema.parse({
      place: ['Bethesda,MD', 'Chevy Chase,DC'],
    });
    expect(parsed.place).toEqual([
      { city: 'Bethesda', state: 'MD' },
      { city: 'Chevy Chase', state: 'DC' },
    ]);
  });

  it('combines with slug, listingType, minCount and limit', () => {
    const parsed = neighborhoodsRequestSchema.parse({
      place: 'Bethesda,MD',
      slug: 'x',
      listingType: 'sale',
      minCount: '2',
      limit: '5',
    });
    expect(parsed).toMatchObject({ listingType: 'sale', minCount: 2, limit: 5, slug: 'x' });
  });

  it.each([
    ['no state', 'Bethesda'],
    ['bad state', 'Bethesda,MDD'],
    ['digit state', 'Bethesda,M1'],
    ['empty city', ',MD'],
    ['blank city', '  ,MD'],
    ['empty item', ''],
  ])('rejects a malformed item: %s', (_name, place) => {
    expect(parse({ place }).success).toBe(false);
  });

  it('rejects an empty list and an empty item in a list', () => {
    expect(parse({ place: [] }).success).toBe(false);
    expect(parse({ place: ['Bethesda,MD', ''] }).success).toBe(false);
  });

  it('rejects a case-insensitive duplicate', () => {
    expect(parse({ place: ['Bethesda,MD', 'BETHESDA, md'] }).success).toBe(false);
  });

  it('accepts the same city in two states', () => {
    expect(parse({ place: ['Chevy Chase,MD', 'Chevy Chase,DC'] }).success).toBe(true);
  });

  it('accepts 25 items and rejects 26', () => {
    const list = (n: number) => Array.from({ length: n }, (_v, i) => `City ${i},MD`);
    expect(parse({ place: list(25) }).success).toBe(true);
    expect(parse({ place: list(26) }).success).toBe(false);
  });

  it.each([['city'], ['state']])('rejects place with %s and names both', (other) => {
    const result = parse({ place: 'Bethesda,MD', [other]: other === 'state' ? 'MD' : 'Bethesda' });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['place', other]));
    expect(result.error?.issues[0]?.message).toContain(other);
  });

  it('still accepts city and state without place', () => {
    expect(parse({ city: 'Bethesda', state: 'MD' }).success).toBe(true);
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
