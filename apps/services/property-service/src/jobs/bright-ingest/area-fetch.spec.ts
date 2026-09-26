import type { FetchLike } from './bright-client';
import { fetchAreaListings } from './area-fetch';
import { createMemoryStore } from './mock-reso-server';
import { BRIGHT_STATUS_FILTER_LABELS } from '../bright-map/status';
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
 * `StandardStatus`, the two predicates `buildAreaQuery` emits. Like Bright, it matches the $filter
 * LABEL ('Coming Soon') against the payload value a record carries ('ComingSoon'). Records every requested URL so a
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
      .filter(
        (row) =>
          BRIGHT_STATUS_FILTER_LABELS[row.StandardStatus] === status && row.ListingKey > after,
      )
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
      "City eq 'Rockville' and StandardStatus eq 'Coming Soon' and ListingKey gt 0",
    );
  });

  it('refuses an area with neither city nor ZIP', () => {
    expect(() =>
      buildAreaQuery({ serviceRoot: SERVICE_ROOT, status: 'Active', afterKey: null, top: 10 }),
    ).toThrow();
  });

  /**
   * The scheduled per-area refresh (#331) bounds its pass to what changed since the area's last
   * sync, so it never re-reads a status's whole backlog on every scheduled tick.
   */
  it('adds a ModificationTimestamp window only when the refresh job asks for one', () => {
    const url = new URL(
      buildAreaQuery({
        serviceRoot: SERVICE_ROOT,
        city: 'Rockville',
        status: 'Active',
        afterKey: null,
        top: 200,
        modifiedAfter: '2026-09-25T00:00:00Z',
        modifiedUntil: '2026-09-26T00:00:00Z',
      }),
    );

    expect(url.searchParams.get('$filter')).toBe(
      "City eq 'Rockville' and StandardStatus eq 'Active' and ListingKey gt 0 and " +
        'ModificationTimestamp gt 2026-09-25T00:00:00.000Z and ' +
        'ModificationTimestamp le 2026-09-26T00:00:00.000Z',
    );

    const ordinary = new URL(
      buildAreaQuery({
        serviceRoot: SERVICE_ROOT,
        city: 'Rockville',
        status: 'Active',
        afterKey: null,
        top: 200,
      }),
    );
    expect(ordinary.searchParams.get('$filter')).not.toContain('ModificationTimestamp');
  });

  it('rejects an unparsable ModificationTimestamp bound', () => {
    expect(() =>
      buildAreaQuery({
        serviceRoot: SERVICE_ROOT,
        city: 'Rockville',
        status: 'Active',
        afterKey: null,
        top: 200,
        modifiedAfter: 'not-a-date',
      }),
    ).toThrow(/not a valid ISO-8601/);
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
      status: 'Active',
      afterKey: null,
      pageSize: 2,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(result).toEqual({
      listingKeys: ['1', '2', '3', '4', '5'],
      pagesFetched: 3,
      complete: true,
      afterKey: null,
    });
    expect(memory.cursors.size).toBe(0);
    expect(memory.rows.size).toBe(5);
  });

  it('fetches only the requested status', async () => {
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
      status: 'ComingSoon',
      afterKey: null,
      pageSize: 200,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(result).toEqual({
      listingKeys: ['10'],
      pagesFetched: 1,
      complete: true,
      afterKey: null,
    });
    expect(
      urls.every((url) =>
        decodeURIComponent(url.replace(/\+/g, ' ')).includes("StandardStatus eq 'Coming Soon'"),
      ),
    ).toBe(true);
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
      status: 'ComingSoon',
      afterKey: null,
      pageSize: 200,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(result.listingKeys).toEqual(['7']);
    expect(result.complete).toBe(true);
  });

  it('stops at maxRecords and returns the cursor to resume from, instead of restarting at null', async () => {
    const memory = createMemoryStore();
    const all = [1, 2, 3, 4, 5, 6].map((key) => listing(key));
    const { fetchImpl } = fixtureFetch(all, 2);

    const capped = await fetchAreaListings({
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: HOST,
      tokenProvider,
      store: memory.store,
      feedTier: 'production',
      runId: 'run-1',
      city: 'Rockville',
      status: 'Active',
      afterKey: null,
      pageSize: 2,
      maxRecords: 4,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    expect(capped).toEqual({
      listingKeys: ['1', '2', '3', '4'],
      pagesFetched: 2,
      complete: false,
      afterKey: '4',
    });

    const resumed = await fetchAreaListings({
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: HOST,
      tokenProvider,
      store: memory.store,
      feedTier: 'production',
      runId: 'run-2',
      city: 'Rockville',
      status: 'Active',
      afterKey: capped.afterKey,
      pageSize: 2,
      maxRecords: 100,
      pageOptions: { fetchImpl, maxRetries: 0 },
    });

    // Two pages: [5, 6] (a full page, pageSize 2) and then a short (empty) page that signals the end.
    expect(resumed).toEqual({
      listingKeys: ['5', '6'],
      pagesFetched: 2,
      complete: true,
      afterKey: null,
    });
  });
});
