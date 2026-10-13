import { PAGE_SIZE_DEFAULT } from '@cribstop/property-contracts';
import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { initialQueryFor, loadInitialResults } from './listings-initial';

jest.mock('next/headers', () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock('@/app/api/_lib/listings-gateway', () => ({
  clientIpOf: () => null,
  proxyListingsRead: jest.fn(),
}));

const mockedRead = proxyListingsRead as jest.Mock;
const envelope = { results: [], total: 0, page: 1, pageSize: 20, pageCount: 1, appliedFilters: {} };

afterEach(() => mockedRead.mockReset());

describe('loadInitialResults (#841)', () => {
  it('reads through the shared web read cache, keyed by the allowlisted query', async () => {
    mockedRead.mockResolvedValue({ ok: true, json: async () => envelope });
    const result = await loadInitialResults('beds=3', {
      filters: { city: 'Alexandria', state: 'VA', listingType: 'sale' },
    });
    expect(result).toEqual(envelope);
    const [path, query, options] = mockedRead.mock.calls[0];
    expect(path).toBe('');
    expect(options).toMatchObject({ cache: true });
    const sent = new URLSearchParams(query);
    expect(sent.get('city')).toBe('Alexandria');
    expect(sent.get('beds')).toBe('3');
    expect(sent.get('pageSize')).toBe(String(PAGE_SIZE_DEFAULT));
  });

  it('sends one identical query for one identical request, so a repeat crawl hits the cache key', async () => {
    mockedRead.mockResolvedValue({ ok: true, json: async () => envelope });
    const place = { filters: { city: 'Alexandria', state: 'VA' } };
    await loadInitialResults('', place);
    await loadInitialResults('', place);
    expect(mockedRead.mock.calls[0][1]).toBe(mockedRead.mock.calls[1][1]);
  });

  it('returns nothing for a grouped view and on a failed read', async () => {
    expect(await loadInitialResults('groupBy=zip', { filters: {} })).toBeUndefined();
    mockedRead.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await loadInitialResults('', { filters: {} })).toBeUndefined();
    mockedRead.mockRejectedValue(new Error('down'));
    expect(await loadInitialResults('', { filters: {} })).toBeUndefined();
  });
});

describe('the query round trip (#841)', () => {
  it('drops no allowlisted parameter and adds none', () => {
    const request = {
      city: 'Alexandria',
      state: 'VA',
      listingType: 'sale',
      minPrice: 300000,
      maxPrice: 900000,
      beds: 3,
      sort: 'price-asc',
      page: 2,
      pageSize: PAGE_SIZE_DEFAULT,
    };
    const sent = new URLSearchParams(initialQueryFor(request as never));
    expect([...sent.keys()].sort()).toEqual(Object.keys(request).sort());
    for (const [key, value] of Object.entries(request)) {
      expect(sent.get(key)).toBe(String(value));
    }
  });

  it('drops a parameter that is not in the contract', () => {
    const sent = new URLSearchParams(
      initialQueryFor({ city: 'Alexandria', occupants: 4 } as never),
    );
    expect(sent.has('occupants')).toBe(false);
  });
});
