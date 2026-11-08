jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T>(fn: T) => fn }));
jest.mock('next/headers', () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock('@/app/api/_lib/listings-gateway', () => ({
  clientIpOf: () => null,
  proxyListingsRead: jest.fn(),
}));

import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { loadCityMedians, loadCityStats } from './city-stats';

const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });

/** A fake feed of sorted prices. `null` is a seller-suppressed price. */
function feed(prices: (number | null)[]) {
  (proxyListingsRead as jest.Mock).mockImplementation(async (path: string, query: string) => {
    if (path === '/meta') {
      return reply({
        lastSyncedAt: '2026-10-14T12:00:00.000Z',
        dataUpdatedAt: null,
        sources: ['brightMLS'],
        listingCount: prices.length,
      });
    }
    const params = new URLSearchParams(query);
    const pool = params.get('minPrice') ? prices.filter((p) => p !== null) : prices;
    const page = Number(params.get('page'));
    return reply({ total: pool.length, results: [{ price: pool[page - 1] }] });
  });
}

const place = { filters: { listingType: 'sale' as const } };

describe('loadCityStats (#842)', () => {
  afterEach(() => jest.clearAllMocks());

  it('reads the count and the median of an odd set, never counting a withheld price', async () => {
    feed([100, 200, 300, null]);
    await expect(loadCityStats('', place)).resolves.toEqual({
      activeCount: 4,
      medianPrice: 200,
      asOf: '2026-10-14T12:00:00.000Z',
      sources: ['brightMLS'],
    });
  });

  it('averages the two middle prices of an even set', async () => {
    feed([100, 200, 300, 500]);
    const stats = await loadCityStats('', place);
    expect(stats?.medianPrice).toBe(250);
  });

  it('has no median when no listing publishes a price', async () => {
    feed([null, null]);
    const stats = await loadCityStats('', place);
    expect(stats).toMatchObject({ activeCount: 2, medianPrice: null });
  });

  it('counts Active listings only', async () => {
    feed([100]);
    await loadCityStats('', place);
    const query = (proxyListingsRead as jest.Mock).mock.calls.find(([path]) => path === '')?.[1];
    expect(new URLSearchParams(query).get('status')).toBe('Active');
  });

  it('returns null when the feed has no date, so no figure goes undated', async () => {
    (proxyListingsRead as jest.Mock).mockImplementation(async (path: string) =>
      path === '/meta'
        ? reply({ lastSyncedAt: null, dataUpdatedAt: null, sources: ['brightMLS'] })
        : reply({ total: 1, results: [{ price: 100 }] }),
    );
    await expect(loadCityStats('', place)).resolves.toBeNull();
  });

  it('returns null when the feed names no source', async () => {
    (proxyListingsRead as jest.Mock).mockImplementation(async (path: string) =>
      path === '/meta'
        ? reply({ lastSyncedAt: '2026-10-14T12:00:00.000Z', dataUpdatedAt: null, sources: [] })
        : reply({ total: 1, results: [{ price: 100 }] }),
    );
    await expect(loadCityStats('', place)).resolves.toBeNull();
  });

  it('returns null when the feed fails', async () => {
    (proxyListingsRead as jest.Mock).mockResolvedValue(reply({}, false));
    await expect(loadCityStats('', place)).resolves.toBeNull();
  });
});

describe('loadCityMedians (#986)', () => {
  const body = {
    listingCount: 42,
    medianListPrice: { value: 525000, inputCount: 40 },
    medianDaysOnMarket: { value: null, inputCount: 3 },
    medianPricePerSqft: { value: 312, inputCount: 35 },
    dataUpdatedAt: '2026-10-14T12:00:00.000Z',
  };
  afterEach(() => jest.clearAllMocks());

  it('reads the endpoint with the city, state and type, and keeps a null figure', async () => {
    (proxyListingsRead as jest.Mock).mockResolvedValue(reply(body));
    await expect(loadCityMedians('Alexandria', 'VA', 'rent')).resolves.toEqual(body);
    expect(proxyListingsRead).toHaveBeenCalledWith(
      '/city-stats',
      'city=Alexandria&state=VA&listingType=rent',
      expect.objectContaining({ cache: true }),
    );
  });

  it('returns null on a failed response', async () => {
    (proxyListingsRead as jest.Mock).mockResolvedValue(reply({}, false));
    await expect(loadCityMedians('Alexandria', 'VA', 'sale')).resolves.toBeNull();
  });

  it('returns null on a body that breaks the contract', async () => {
    (proxyListingsRead as jest.Mock).mockResolvedValue(reply({ listingCount: 'many' }));
    await expect(loadCityMedians('Alexandria', 'VA', 'sale')).resolves.toBeNull();
  });

  it('returns null when the call throws', async () => {
    (proxyListingsRead as jest.Mock).mockRejectedValue(new Error('down'));
    await expect(loadCityMedians('Alexandria', 'VA', 'sale')).resolves.toBeNull();
  });
});
