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
