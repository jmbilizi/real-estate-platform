import type { FetchLike } from './bright-client';
import { fetchAreaListings } from './area-fetch';
import { createMemoryStore } from './mock-reso-server';
import { buildAreaQuery, isOrderedWithoutFilter } from './odata-query';

const SERVICE_ROOT = 'https://bright-reso.tst.brightmls.com/RESO/OData/bright';
const HOST = 'bright-reso.tst.brightmls.com';
const tokenProvider = () =>
  Promise.resolve({ accessToken: 'fixture-token', expiresInSeconds: 3600 });

interface FixtureListing {
  readonly ListingKey: number;
  readonly ModificationTimestamp: string;
  readonly City: string;
  readonly StandardStatus: string;
}

function listing(key: number, status = 'Active'): FixtureListing {
  return {
    ListingKey: key,
    ModificationTimestamp: '2026-09-20T00:00:00Z',
    City: 'Rockville',
    StandardStatus: status,
  };
}

/**
 * A `FetchLike` over an in-memory record set, keyset-paging on `ListingKey` and filtering on
 * `StandardStatus`, the two predicates `buildAreaQuery` emits. Records every requested URL so a
 * test can assert how many passes ran and with which status.
 */
function fixtureFetch(
  all: readonly FixtureListing[],
  pageSize: number,
): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    const decoded = decodeURIComponent(url.replace(/\+/g, ' '));
    const after = Number(/ListingKey gt (\d+)/.exec(decoded)?.[1] ?? 0);
    const status = /StandardStatus eq '([^']*)'/.exec(decoded)?.[1] ?? '';
    const value = all
      .filter((row) => row.StandardStatus === status && row.ListingKey > after)
      .slice(0, pageSize);
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ value })),
    });
  };
  return { fetchImpl, urls };
}

describe('buildAreaQuery', () => {
  it('filters one place and the requested status, and keyset-pages on ListingKey', () => {
    const url = new URL(
      buildAreaQuery({
        serviceRoot: SERVICE_ROOT,
        city: "O'Fallon",
        state: 'MD',
        status: 'Active',
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

  it('emits the requested status, not a hardcoded one', () => {
    const url = new URL(
      buildAreaQuery({
        serviceRoot: SERVICE_ROOT,
        city: 'Rockville',
        status: 'ComingSoon',
        afterKey: null,
        top: 200,
      }),
    );

    expect(url.searchParams.get('$filter')).toBe(
      "City eq 'Rockville' and StandardStatus eq 'ComingSoon' and ListingKey gt 0",
    );
  });

  it('refuses an area with neither city nor ZIP', () => {
    expect(() =>
      buildAreaQuery({ serviceRoot: SERVICE_ROOT, status: 'Active', afterKey: null, top: 10 }),
    ).toThrow();
  });
});

describe('fetchAreaListings', () => {
  it('pages by ListingKey until a short page, staging every record without a cursor', async () => {
    const memory = createMemoryStore();
    const all = [1, 2, 3, 4, 5].map((key) => listing(key));
    const { fetchImpl } = fixtureFetch(all, 2);

    const result = await fetchAreaListings({
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: HOST,
      tokenProvider,
      store: memory.store,
      feedTier: 'production',
      runId: 'run-1',
      city: 'Rockville',
      statuses: ['Active'],
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

  it('runs one keyset pass per searchable status, resetting afterKey between statuses', async () => {
    const memory = createMemoryStore();
    const all = [
      listing(1, 'Active'),
      listing(2, 'Active'),
      listing(10, 'ComingSoon'),
      listing(20, 'ActiveUnderContract'),
    ];
    const { fetchImpl, urls } = fixtureFetch(all, 200);

    const result = await fetchAreaListings({
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: HOST,
      tokenProvider,
      store: memory.store,
      feedTier: 'production',
      runId: 'run-1',
      city: 'Rockville',
      statuses: ['Active', 'ComingSoon', 'ActiveUnderContract'],
      pageSize: 200,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(result).toEqual({
      listingKeys: ['1', '2', '10', '20'],
      pagesFetched: 3,
      complete: true,
    });
    // One request per status, each starting from ListingKey gt 0.
    expect(urls.filter((url) => url.includes('ListingKey+gt+0')).length).toBe(3);
  });

  it('returns a Coming Soon listing for a city with no Active listings', async () => {
    const memory = createMemoryStore();
    const all = [listing(7, 'ComingSoon')];
    const { fetchImpl } = fixtureFetch(all, 200);

    const result = await fetchAreaListings({
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: HOST,
      tokenProvider,
      store: memory.store,
      feedTier: 'production',
      runId: 'run-1',
      city: 'Frederick',
      statuses: ['Active', 'ComingSoon'],
      pageSize: 200,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(result.listingKeys).toEqual(['7']);
    expect(result.complete).toBe(true);
  });
});
