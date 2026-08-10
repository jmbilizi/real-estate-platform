import { listingsMetaSchema } from './listings-meta';

describe('listingsMetaSchema', () => {
  it('allows a null freshness timestamp for an empty dataset', () => {
    const parsed = listingsMetaSchema.parse({
      dataUpdatedAt: null,
      sources: [],
      listingCount: 0,
    });
    expect(parsed.dataUpdatedAt).toBeNull();
  });

  it('requires dataUpdatedAt to be present', () => {
    expect(listingsMetaSchema.safeParse({ sources: [], listingCount: 0 }).success).toBe(false);
  });
});
