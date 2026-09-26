import { type LocalBrightListing, staleListingIds } from './reconcile';

function listing(id: string, sourceListingKey: string): LocalBrightListing {
  return { id, sourceListingKey };
}

describe('staleListingIds', () => {
  it('returns the id of a local listing whose key is absent from the live set', () => {
    const local = [listing('l1', '111'), listing('l2', '222')];
    expect(staleListingIds(new Set(['111']), local)).toEqual(['l2']);
  });

  it('returns nothing when every local key is still live', () => {
    const local = [listing('l1', '111'), listing('l2', '222')];
    expect(staleListingIds(new Set(['111', '222']), local)).toEqual([]);
  });

  it('never flags a listing whose key is live under a different tracked status', () => {
    // The caller is responsible for building `liveKeys` as the UNION across every tracked status
    // for the area (run-reconcile.ts) — a key present under ANY status must survive here.
    const local = [listing('l1', '111')];
    const liveAcrossAllStatuses = new Set(['111']);
    expect(staleListingIds(liveAcrossAllStatuses, local)).toEqual([]);
  });

  it('returns every id when the live set is empty', () => {
    const local = [listing('l1', '111'), listing('l2', '222')];
    expect(staleListingIds(new Set(), local)).toEqual(['l1', 'l2']);
  });
});
