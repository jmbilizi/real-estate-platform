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

  it('allows lastSyncedAt to be omitted, for older deployments', () => {
    const parsed = listingsMetaSchema.parse({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: [],
      listingCount: 0,
    });
    expect(parsed.lastSyncedAt).toBeUndefined();
  });

  it('allows lastSyncedAt to be null, when no sync run has succeeded yet', () => {
    const parsed = listingsMetaSchema.parse({
      dataUpdatedAt: null,
      lastSyncedAt: null,
      sources: [],
      listingCount: 0,
    });
    expect(parsed.lastSyncedAt).toBeNull();
  });
});
