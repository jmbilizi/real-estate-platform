import type { FetchLike } from './bright-client';
import { fetchAreaListings } from './area-fetch';
import { createMemoryStore } from './mock-reso-server';
import { buildAreaQuery, isOrderedWithoutFilter } from './odata-query';

const SERVICE_ROOT = 'https://bright-reso.tst.brightmls.com/RESO/OData/bright';
const HOST = 'bright-reso.tst.brightmls.com';
const tokenProvider = () =>
  Promise.resolve({ accessToken: 'fixture-token', expiresInSeconds: 3600 });

function listing(key: number) {
  return { ListingKey: key, ModificationTimestamp: '2026-09-20T00:00:00Z', City: 'Rockville' };
}

describe('buildAreaQuery', () => {
  it('filters one place and active status, and keyset-pages on ListingKey', () => {
    const url = new URL(
      buildAreaQuery({
        serviceRoot: SERVICE_ROOT,
        city: "O'Fallon",
        state: 'MD',
        afterKey: '42',
        top: 200,
      }),
    );

    expect(url.searchParams.get('$filter')).toBe(
      "City eq 'O''Fallon' and StateOrProvince eq 'MD' and StandardStatus eq 'Active' and ListingKey gt 42",
    );
    expect(url.searchParams.get('$orderby')).toBe('ListingKey asc');
    expect(url.searchParams.get('$top')).toBe('200');
    expect(url.search).not.toMatch(/\bor\b/i);
    expect(isOrderedWithoutFilter(url.toString())).toBe(false);
  });

  it('refuses an area with neither city nor ZIP', () => {
    expect(() => buildAreaQuery({ serviceRoot: SERVICE_ROOT, afterKey: null, top: 10 })).toThrow();
  });
});

describe('fetchAreaListings', () => {
  it('pages by ListingKey until a short page, staging every record without a cursor', async () => {
    const memory = createMemoryStore();
    const urls: string[] = [];
    const all = [1, 2, 3, 4, 5].map(listing);
    const fetchImpl: FetchLike = (url) => {
      urls.push(url);
      const after = Number(
        /ListingKey gt (\d+)/.exec(decodeURIComponent(url.replace(/\+/g, ' ')))?.[1] ?? 0,
      );
      const value = all.filter((row) => row.ListingKey > after).slice(0, 2);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ value })),
      });
    };

    const result = await fetchAreaListings({
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: HOST,
      tokenProvider,
      store: memory.store,
      runId: 'run-1',
      city: 'Rockville',
      pageSize: 2,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(result).toEqual({
      listingKeys: ['1', '2', '3', '4', '5'],
      pagesFetched: 3,
      complete: true,
    });
    expect(memory.cursors.size).toBe(0);
    expect(memory.rows.size).toBe(5);
  });
});
