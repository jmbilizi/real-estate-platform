import { LISTINGS_BY_IDS_MAX, listingsByIdsRequestSchema } from './listings-by-ids';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('listingsByIdsRequestSchema', () => {
  it('accepts a comma list and repeated parameters', () => {
    expect(listingsByIdsRequestSchema.parse({ ids: `${id(1)}, ${id(2)}` }).ids).toEqual([
      id(1),
      id(2),
    ]);
    expect(
      listingsByIdsRequestSchema.parse({ ids: [id(1), `${id(2)},${id(3)}`] }).ids,
    ).toHaveLength(3);
  });

  it('accepts a set at the cap and rejects a set over it', () => {
    const at = Array.from({ length: LISTINGS_BY_IDS_MAX }, (_, i) => id(i)).join(',');
    expect(listingsByIdsRequestSchema.safeParse({ ids: at }).success).toBe(true);
    expect(listingsByIdsRequestSchema.safeParse({ ids: `${at},${id(99)}` }).success).toBe(false);
  });

  it('rejects an empty set, a malformed id and an unknown key', () => {
    expect(listingsByIdsRequestSchema.safeParse({}).success).toBe(false);
    expect(listingsByIdsRequestSchema.safeParse({ ids: '' }).success).toBe(false);
    expect(listingsByIdsRequestSchema.safeParse({ ids: 'nope' }).success).toBe(false);
    expect(listingsByIdsRequestSchema.safeParse({ ids: id(1), fields: 'id' }).success).toBe(false);
  });
});
