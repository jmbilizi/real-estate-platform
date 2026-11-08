/** @jest-environment node */
import { PROPERTY_TYPES } from '@cribstop/property-contracts';
import { aListingCardRow } from '@/test/fixtures';

const mockFetchGateway = jest.fn();
jest.mock('@/app/api/_lib/gateway', () => ({
  fetchGateway: (...args: unknown[]) => mockFetchGateway(...args),
}));

function envelope(results: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      results,
      total: results.length,
      page: 1,
      pageSize: 100,
      pageCount: 1,
      appliedFilters: {},
    }),
  };
}

const ID = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

async function load() {
  jest.resetModules();
  const mod = await import('./sitemap-listings');
  return mod.loadSitemapListings();
}

beforeEach(() => {
  mockFetchGateway.mockReset();
  mockFetchGateway.mockResolvedValue(envelope([]));
});

describe('loadSitemapListings', () => {
  it('never returns a suppressed-address, sample or sold listing', async () => {
    mockFetchGateway.mockResolvedValueOnce(
      envelope([
        aListingCardRow({ id: ID(1), isSample: false }),
        aListingCardRow({ id: ID(2), address: null, isSample: false }),
        aListingCardRow({ id: ID(3), isSample: true }),
        aListingCardRow({ id: ID(4), status: 'Sold', isSample: false }),
      ]),
    );
    const listings = await load();
    expect(listings.map((l) => l.id)).toEqual([ID(1)]);
  });

  it('fails instead of publishing a partial feed when a slice fails', async () => {
    mockFetchGateway.mockResolvedValueOnce({ ok: false });
    await expect(load()).rejects.toThrow('unavailable');
  });

  it('queries each listing type and property type, never sold', async () => {
    await load();
    expect(mockFetchGateway).toHaveBeenCalledTimes(2 * PROPERTY_TYPES.length);
    const urls = mockFetchGateway.mock.calls.map((call) => String(call[0]));
    expect(urls.every((url) => !url.includes('listingType=sold'))).toBe(true);
  });
});

describe('place tally (#845)', () => {
  async function loadFeed() {
    jest.resetModules();
    const mod = await import('./sitemap-listings');
    return mod.loadSitemapFeed();
  }

  const base = { state: 'VA', isSample: false };

  it('counts Active listings per city and segment the way a city page does', async () => {
    mockFetchGateway.mockResolvedValueOnce(
      envelope([
        aListingCardRow({
          ...base,
          id: ID(1),
          city: 'Reston',
          lastUpdated: '2026-09-01T00:00:00.000Z',
        }),
        aListingCardRow({
          ...base,
          id: ID(2),
          city: 'Reston',
          address: null,
          lastUpdated: '2026-10-01T00:00:00.000Z',
        }),
        aListingCardRow({
          ...base,
          id: ID(3),
          city: 'Reston',
          isSample: true,
          lastUpdated: '2026-08-01T00:00:00.000Z',
        }),
        aListingCardRow({ ...base, id: ID(4), city: 'Reston', status: 'Pending' }),
        aListingCardRow({ ...base, id: ID(5), city: 'Reston', status: 'Sold' }),
        aListingCardRow({ ...base, id: ID(6), city: 'Fairfax', listingType: 'rent' }),
      ]),
    );
    const feed = await loadFeed();
    expect(feed.places).toEqual([
      expect.objectContaining({ city: 'Fairfax', segment: 'homes-for-rent', activeCount: 1 }),
      {
        city: 'Reston',
        state: 'VA',
        segment: 'homes-for-sale',
        activeCount: 3,
        lastUpdated: '2026-10-01T00:00:00.000Z',
      },
    ]);
    // The listings stay limited to rows that may appear.
    expect(feed.listings.map((l) => l.id).sort()).toEqual([ID(1), ID(4), ID(6)].sort());
  });

  it('serves the stale snapshot at once while one refresh runs', async () => {
    jest.resetModules();
    jest.useFakeTimers();
    try {
      const mod = await import('./sitemap-listings');
      mockFetchGateway.mockResolvedValue(envelope([aListingCardRow({ id: ID(1) })]));
      const first = await mod.loadSitemapFeed();
      const calls = mockFetchGateway.mock.calls.length;
      jest.setSystemTime(Date.now() + 11 * 60 * 1000);
      mockFetchGateway.mockReturnValue(new Promise(() => undefined));
      const second = await mod.loadSitemapFeed();
      expect(second).toBe(first);
      expect(mockFetchGateway.mock.calls.length).toBeGreaterThan(calls);
    } finally {
      jest.useRealTimers();
    }
  });
});
