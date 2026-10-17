import { cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithClient } from '@/test/renderWithClient';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsMeta, getNeighborhoods, searchListings } from '@/lib/api/listings';
import { listRecentSavedHomes } from '@/lib/api/saved-homes';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoods: jest.fn(),
}));

// No licensed market by default, so a visitor with no signal has no target (the pre-#834 shape).
// One test pushes a market in to cover the cold-start rotation.

jest.mock('@/config/licensed-markets.json', () => ({ __esModule: true, default: [] }));
const mockMarkets: { city: string; state: string }[] = jest.requireMock(
  '@/config/licensed-markets.json',
).default;

// HomePageContent itself does not read useApp()/listingType (#361, #392) — but ListingCard,
// rendered inside every carousel row, still calls useApp() for save/unsave. Without this mock the
// cards throw for lack of a react-redux Provider, unrelated to what this file is testing.
jest.mock('@/lib/api/saved-homes', () => ({ listRecentSavedHomes: jest.fn() }));

let mockUser: { email: string } | null = null;
let mockSavedIds = new Set<string>();
jest.mock('@/lib/context', () => ({
  useApp: () => ({
    listingType: 'sale',
    toggleSave: jest.fn(),
    isSaved: () => false,
    user: mockUser,
    savedPropertyIds: mockSavedIds,
  }),
}));

// #433: ListingCard's footer share/copy-link controls call useToast(), which needs a
// react-redux Provider absent from these tests. Same reasoning as the context mock above.
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

// #868. The page mounts about 60 row-skeleton cards, roughly 30 nodes each, on first paint. That
// render made each test take about 1 s alone and time out on a loaded runner. This file tests
// the rows, not the card placeholder, so a one-node stand-in keeps the `data-skeleton-card`
// marker and drops the cost. ListingStates owns the placeholder markup.
jest.mock('@/components/listing/ListingStates', () => ({
  ...jest.requireActual('@/components/listing/ListingStates'),
  ListingCardSkeleton: () => <div aria-hidden="true" data-skeleton-card />,
}));

const mockedSearchListings = searchListings as jest.Mock;
const mockedGetListingsMeta = getListingsMeta as jest.Mock;
const mockedGetNeighborhoods = getNeighborhoods as jest.Mock;
const mockedRecentSaved = listRecentSavedHomes as jest.Mock;

function neighborhoodRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Columbia Heights',
    city: 'Washington',
    state: 'DC',
    slug: 'columbia-heights',
    total: 300,
    sale: 207,
    rent: 93,
    ...overrides,
  };
}

function envelope(rows: ReturnType<typeof aListingCardRow>[], total = rows.length) {
  return {
    results: rows,
    total,
    page: 1,
    pageSize: 8,
    pageCount: 1,
    appliedFilters: {},
  };
}

type Query = {
  status?: string[];
  listedWithinDays?: number;
  priceReduced?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  propertyType?: string[];
  listingType?: string;
  city?: string;
  state?: string;
};

/** Which row a query belongs to, by its distinguishing filter — never by call order, since order
 *  changes with `useRentFirst`. */
function rowKind(
  q: Query,
): 'just-listed' | 'coming-soon' | 'price-drops' | 'price-sort' | 'near-you' {
  if (q.sort === 'price-asc' || q.sort === 'price-desc') return 'price-sort';
  if (q.priceReduced) return 'price-drops';
  if (q.status?.includes('Coming Soon')) return 'coming-soon';
  return q.sort === 'newly-listed' ? 'just-listed' : 'near-you';
}

/** Mocks `/api/geo/region`, the one fetch `useRegion` makes. `null` (the default) matches every
 *  existing test in this file: no region, so no "near you" row and no region-scoped query. */
function mockRegionFetch(region: { city: string; state: string } | null = null) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(region),
  });
}

describe('HomePageContent', () => {
  // #915. The 1 s default for findBy/waitFor is shorter than a loaded runner needs to mount the
  // page and chain the region and neighborhood requests. Stay under the 10 s test timeout.
  const defaultAsyncTimeout = 1000;
  beforeAll(() => configure({ asyncUtilTimeout: 5000 }));
  afterAll(() => configure({ asyncUtilTimeout: defaultAsyncTimeout }));

  beforeEach(() => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['internal'],
      listingCount: 13,
    });
    mockedSearchListings.mockResolvedValue(envelope([aListingCardRow()]));
    mockedGetNeighborhoods.mockResolvedValue({ results: [], total: 0 });
    global.fetch = jest.fn();
    mockRegionFetch(null);
  });

  afterEach(() => {
    cleanup();
    mockedSearchListings.mockReset();
    mockedGetListingsMeta.mockReset();
    mockedGetNeighborhoods.mockReset();
    (global.fetch as jest.Mock).mockReset();
    mockedRecentSaved.mockReset();
    mockUser = null;
    mockSavedIds = new Set();
    window.localStorage.clear();
  });

  describe('cheap requests (#755)', () => {
    it('asks every row for its cards without the exact match count', async () => {
      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(7));

      for (const [query] of mockedSearchListings.mock.calls) {
        // Rows that dedupe against each other fetch 7 extra cards (#873).
        const dedupes = ['near-you', 'just-listed', 'price-drops'].includes(rowKind(query));
        expect(query).toMatchObject({ skipTotal: true, pageSize: dedupes ? 15 : 8 });
      }
    });

    it('fails one row without failing the others', async () => {
      mockedSearchListings.mockImplementation((query: Query) =>
        query.priceReduced
          ? Promise.reject(new Error('503'))
          : Promise.resolve(envelope([aListingCardRow()])),
      );

      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      expect(await screen.findByText('Price drops on homes for sale')).toBeInTheDocument();
      expect(await screen.findAllByText(/Tap to retry/i)).toHaveLength(1);
    });
  });

  describe('titles (#394, #419)', () => {
    it('renders every row title, and no subtitle text under any of them', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });
      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Be first to see homes coming for sale')).toBeInTheDocument();
      expect(screen.getByText('Price drops on homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Newest rentals')).toBeInTheDocument();
      expect(screen.getByText("See new rentals before they're listed")).toBeInTheDocument();
      expect(screen.getByText('Cheapest homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Cheapest rentals')).toBeInTheDocument();
      expect(screen.getByText('Explore neighborhoods')).toBeInTheDocument();

      // No count/place subtitle line under any row.
      expect(screen.queryByText(/\d+ homes?/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+ rentals?/)).not.toBeInTheDocument();
    });
  });

  describe('row queries (#394)', () => {
    it('queries "just listed" by the newly-listed sort, one row per side, with no date cutoff', async () => {
      renderWithClient(<HomePageContent />);

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ listingType: 'sale', sort: 'newly-listed' }),
          expect.anything(),
        ),
      );
      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ listingType: 'rent', sort: 'newly-listed' }),
          expect.anything(),
        ),
      );
      const calls = mockedSearchListings.mock.calls.map(([q]) => q as Query);
      expect(calls.every((q) => q.listedWithinDays === undefined)).toBe(true);
    });

    it('queries "price drops" by priceReduced and the newly-listed sort, sale only', async () => {
      renderWithClient(<HomePageContent />);

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({
            listingType: 'sale',
            priceReduced: true,
            sort: 'newly-listed',
          }),
          expect.anything(),
        ),
      );
      expect(mockedSearchListings).not.toHaveBeenCalledWith(
        expect.objectContaining({ listingType: 'rent', priceReduced: true }),
        expect.anything(),
      );
    });

    it('hides a row when its total is 0 and the fetch has settled', async () => {
      mockedSearchListings.mockImplementation((q: Query) => {
        if (rowKind(q) === 'price-drops') return Promise.resolve(envelope([], 0));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      renderWithClient(<HomePageContent />);

      await screen.findByText('Newest homes for sale');
      await waitFor(() =>
        expect(screen.queryByText('Price drops on homes for sale')).not.toBeInTheDocument(),
      );
    });
  });

  describe('row order (#394)', () => {
    it('orders Just listed, Coming soon (sale), Price drops, then the rentals cluster by default', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });
      const { container } = renderWithClient(<HomePageContent />);
      await screen.findByText('Newest homes for sale');
      // No region resolved (default mock): waits out the near-you row's settling to empty,
      // so this list of headings reflects the final layout, not a mid-settle snapshot.
      await waitFor(() =>
        expect(screen.queryByText('Homes for sale near you')).not.toBeInTheDocument(),
      );

      const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
      expect(headings).toEqual([
        'Newest homes for sale',
        'Be first to see homes coming for sale',
        'Price drops on homes for sale',
        'Newest rentals',
        "See new rentals before they're listed",
        'Cheapest homes for sale',
        'Cheapest rentals',
        'Explore neighborhoods',
        'Real listings, updated 5 months ago',
      ]);
    });

    it('moves the rentals cluster up to follow Just listed when the last search was rent', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });
      window.localStorage.setItem(
        'recentSearches',
        JSON.stringify([{ display_name: 'Baltimore, MD', listingType: 'rent' }]),
      );

      const { container } = renderWithClient(<HomePageContent />);
      await screen.findByText('Newest homes for sale');
      await waitFor(() => expect(screen.queryByText('Rentals near you')).not.toBeInTheDocument());

      const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
      expect(headings).toEqual([
        'Newest homes for sale',
        'Newest rentals',
        "See new rentals before they're listed",
        'Be first to see homes coming for sale',
        'Price drops on homes for sale',
        'Cheapest rentals',
        'Cheapest homes for sale',
        'Explore neighborhoods',
        'Real listings, updated 5 months ago',
      ]);
    });

    it('also puts the rent price-sort row first when the last search was rent', async () => {
      window.localStorage.setItem(
        'recentSearches',
        JSON.stringify([{ display_name: 'Baltimore, MD', listingType: 'rent' }]),
      );

      renderWithClient(<HomePageContent />);

      const [firstHeading] = await screen.findAllByText(/^Cheapest /);
      expect(firstHeading.textContent).toBe('Cheapest rentals');
    });
  });

  describe('coming soon row (#392, #416)', () => {
    it("scopes the query to the visitor's last-searched place", async () => {
      window.localStorage.setItem(
        'recentSearches',
        JSON.stringify([
          {
            display_name: 'Rockville, MD',
            listingType: 'sale',
            address: { city: 'Rockville', state_code: 'MD' },
          },
        ]),
      );

      renderWithClient(<HomePageContent />);

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ status: ['Coming Soon'], city: 'Rockville', state: 'MD' }),
          expect.anything(),
        ),
      );
    });
  });

  describe('home target (#822)', () => {
    const rockville = {
      display_name: 'Rockville, MD',
      address: { city: 'Rockville', state_code: 'MD' },
    };

    function storeSearch(entry: Record<string, unknown>) {
      window.localStorage.setItem('recentSearches', JSON.stringify([entry]));
    }

    it('uses the last search for "near you", not the IP region', async () => {
      mockRegionFetch({ city: 'Ashburn', state: 'VA' });
      storeSearch({ ...rockville, listingType: 'sale', searchedAt: Date.now() });

      renderWithClient(<HomePageContent />);

      await screen.findByText('Homes for sale near you');
      expect(screen.getByText('Homes for sale near you').closest('section')).toHaveAttribute(
        'data-target-source',
        'last-search',
      );
      expect(mockedSearchListings).toHaveBeenCalledWith(
        expect.objectContaining({ listingType: 'sale', city: 'Rockville', state: 'MD' }),
        expect.anything(),
      );
      expect(mockedSearchListings).not.toHaveBeenCalledWith(
        expect.objectContaining({ city: 'Ashburn' }),
        expect.anything(),
      );
    });

    it('ignores a last search older than 30 days and uses the IP region', async () => {
      mockRegionFetch({ city: 'Ashburn', state: 'VA' });
      storeSearch({ ...rockville, searchedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });

      renderWithClient(<HomePageContent />);

      await screen.findByText('Homes for sale near you');
      expect(screen.getByText('Homes for sale near you').closest('section')).toHaveAttribute(
        'data-target-source',
        'ip',
      );
      expect(mockedSearchListings).not.toHaveBeenCalledWith(
        expect.objectContaining({ city: 'Rockville' }),
        expect.anything(),
      );
      // A stale search must not let a place-scoped row send an unscoped query while the IP loads.
      for (const [query] of mockedSearchListings.mock.calls as [Query][]) {
        if (['coming-soon', 'price-sort', 'just-listed', 'price-drops'].includes(rowKind(query)))
          expect(query.city).toBe('Ashburn');
      }
    });

    it('sends no platform-wide query from a place-scoped row while the target resolves', async () => {
      mockRegionFetch({ city: 'Ashburn', state: 'VA' });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Homes for sale near you');

      const scopedKinds = ['coming-soon', 'price-sort', 'just-listed', 'price-drops'];
      for (const [query] of mockedSearchListings.mock.calls as [Query][]) {
        if (scopedKinds.includes(rowKind(query))) expect(query.city).toBe('Ashburn');
      }
    });

    it('uses a granted browser position over the IP region', async () => {
      const permissions = { query: jest.fn().mockResolvedValue({ state: 'granted' }) };
      const geolocation = {
        getCurrentPosition: jest.fn((ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 39.2904, longitude: -76.6122 } }),
        ),
      };
      Object.defineProperty(global.navigator, 'permissions', {
        value: permissions,
        configurable: true,
      });
      Object.defineProperty(global.navigator, 'geolocation', {
        value: geolocation,
        configurable: true,
      });
      (global.fetch as jest.Mock).mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              url.startsWith('/api/geocode/reverse')
                ? { address: { city: 'Baltimore', state_code: 'MD' } }
                : { city: 'Ashburn', state: 'VA' },
            ),
        }),
      );

      try {
        renderWithClient(<HomePageContent />);

        await screen.findByText('Homes for sale near you');
        expect(screen.getByText('Homes for sale near you').closest('section')).toHaveAttribute(
          'data-target-source',
          'geolocation',
        );
        await waitFor(() =>
          expect(mockedSearchListings).toHaveBeenCalledWith(
            expect.objectContaining({ listingType: 'sale', city: 'Baltimore', state: 'MD' }),
            expect.anything(),
          ),
        );
        expect(mockedSearchListings).not.toHaveBeenCalledWith(
          expect.objectContaining({ city: 'Ashburn' }),
          expect.anything(),
        );
        // Rounded to about 1 km before the lookup.
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('lat=39.29&lon=-76.61'),
          expect.anything(),
        );
      } finally {
        delete (global.navigator as unknown as Record<string, unknown>).permissions;
        delete (global.navigator as unknown as Record<string, unknown>).geolocation;
      }
    });
  });

  describe('newest and price-drop rows follow the home target (#873)', () => {
    const kinds = ['just-listed', 'price-drops'];
    const targeted = () =>
      (mockedSearchListings.mock.calls as [Query][])
        .map(([q]) => q)
        .filter((q) => kinds.includes(rowKind(q)));

    it('queries city and state for each row', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });

      renderWithClient(<HomePageContent />);
      await waitFor(() => expect(targeted()).toHaveLength(3));

      for (const q of targeted()) expect(q).toMatchObject({ city: 'Baltimore', state: 'MD' });
      expect(targeted().filter((q) => rowKind(q) === 'just-listed')).toHaveLength(2);
      expect(targeted().filter((q) => rowKind(q) === 'price-drops')).toHaveLength(1);
    });

    it('sends no query while the target resolves', async () => {
      (global.fetch as jest.Mock).mockReturnValue(new Promise(() => undefined));

      renderWithClient(<HomePageContent />);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(targeted()).toHaveLength(0);
    });

    it('queries platform-wide when there is no target', async () => {
      renderWithClient(<HomePageContent />);
      await waitFor(() => expect(targeted()).toHaveLength(3));

      for (const q of targeted()) expect(q.city).toBeUndefined();
    });

    it('keeps the titles place-free and links "View all" with the same city and state', async () => {
      mockRegionFetch({ city: 'Richmond', state: 'VA' });

      renderWithClient(<HomePageContent />);
      const title = await screen.findByText('Newest homes for sale');

      expect(title.textContent).not.toMatch(/Richmond/);
      const href = title
        .closest('section')
        ?.querySelector('a[href*="newly-listed"]')
        ?.getAttribute('href');
      expect(href).toContain('city=Richmond');
      expect(href).toContain('state=VA');
      expect(title.closest('section')).toHaveAttribute('data-target-source', 'ip');
    });

    const priceDrops = () => targeted().filter((q) => rowKind(q) === 'price-drops');
    const priceDropsHref = () =>
      screen
        .getByText('Price drops on homes for sale')
        .closest('section')
        ?.querySelector('a[href*="priceReduced"]')
        ?.getAttribute('href');

    it('widens an empty city to the state and keeps the row', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      mockedSearchListings.mockImplementation((q: Query) =>
        Promise.resolve(
          rowKind(q) === 'price-drops' && q.city ? envelope([], 0) : envelope([aListingCardRow()]),
        ),
      );

      renderWithClient(<HomePageContent />);
      await waitFor(() =>
        expect(priceDrops().map((q) => [q.city, q.state])).toEqual([
          ['Baltimore', 'MD'],
          [undefined, 'MD'],
        ]),
      );
      await waitFor(() => expect(priceDropsHref()).toContain('state=MD'));
      expect(priceDropsHref()).not.toContain('city=');
    });

    it('widens an empty state to platform-wide and keeps the row', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      mockedSearchListings.mockImplementation((q: Query) =>
        Promise.resolve(
          rowKind(q) === 'price-drops' && q.state ? envelope([], 0) : envelope([aListingCardRow()]),
        ),
      );

      renderWithClient(<HomePageContent />);
      await waitFor(() =>
        expect(priceDrops().map((q) => [q.city, q.state])).toEqual([
          ['Baltimore', 'MD'],
          [undefined, 'MD'],
          [undefined, undefined],
        ]),
      );
      await waitFor(() => expect(priceDropsHref()).not.toContain('state='));
    });

    it('hides the row when the platform-wide query is empty too', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      mockedSearchListings.mockImplementation((q: Query) =>
        Promise.resolve(
          rowKind(q) === 'price-drops' ? envelope([], 0) : envelope([aListingCardRow()]),
        ),
      );

      renderWithClient(<HomePageContent />);
      await screen.findByText('Newest homes for sale');

      await waitFor(() => expect(priceDrops()).toHaveLength(3));
      expect(screen.queryByText('Price drops on homes for sale')).not.toBeInTheDocument();
    });
  });

  describe('cross-row dedupe (#873)', () => {
    const pid = (n: number) => `pid-${n}`;
    const cards = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) =>
        aListingCardRow({
          id: `lid-${from + i}`,
          propertyId: pid(from + i),
          propertyPath: `/property/${pid(from + i)}`,
        }),
      );
    const linksIn = (title: string) =>
      new Set(
        [...(screen.getByText(title).closest('section')?.querySelectorAll('a') ?? [])]
          .map((a) => a.getAttribute('href') ?? '')
          .filter((h) => h.startsWith('/property/'))
          .map((h) => h.replace('/property/', '')),
      );
    const mockSaleRows = (rows: {
      nearYou: ReturnType<typeof cards>;
      justListed: ReturnType<typeof cards>;
      priceDrops?: ReturnType<typeof cards>;
    }) =>
      mockedSearchListings.mockImplementation((q: Query) => {
        if (q.listingType !== 'sale') return Promise.resolve(envelope([aListingCardRow()]));
        const kind = rowKind(q);
        if (kind === 'near-you') return Promise.resolve(envelope(rows.nearYou));
        if (kind === 'just-listed') return Promise.resolve(envelope(rows.justListed));
        if (kind === 'price-drops')
          return Promise.resolve(envelope(rows.priceDrops ?? cards(1, 15)));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

    it('skips cards an earlier row shows, so the earlier row wins', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      mockSaleRows({ nearYou: cards(1, 15), justListed: cards(1, 15) });

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(linksIn('Newest homes for sale').has(pid(8))).toBe(true));
      const near = linksIn('Homes for sale near you');
      const newest = linksIn('Newest homes for sale');
      for (let n = 1; n <= 7; n++) {
        expect(near.has(pid(n))).toBe(true);
        expect(newest.has(pid(n))).toBe(false);
      }
    });

    it('keeps the original cards when the drop would leave fewer than 4', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      mockSaleRows({ nearYou: cards(1, 15), justListed: cards(1, 9) });

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(linksIn('Newest homes for sale').size).toBeGreaterThan(0));
      await screen.findByText('Homes for sale near you');
      const newest = linksIn('Newest homes for sale');
      expect(newest.has(pid(1))).toBe(true);
      expect(newest.has(pid(7))).toBe(true);
    });

    it('applies the page order: a later row never removes a card from an earlier row', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      mockSaleRows({
        nearYou: cards(1, 15),
        justListed: cards(1, 15),
        priceDrops: cards(1, 30),
      });

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(linksIn('Price drops on homes for sale').has(pid(15))).toBe(true));
      const near = linksIn('Homes for sale near you');
      const drops = linksIn('Price drops on homes for sale');
      expect(near.has(pid(1))).toBe(true);
      for (let n = 1; n <= 14; n++) expect(drops.has(pid(n))).toBe(false);
    });

    it('never makes a row wait on another row, and shows repeats until the earlier row resolves', async () => {
      mockRegionFetch({ city: 'Baltimore', state: 'MD' });
      let resolveNear: (value: unknown) => void = () => undefined;
      mockedSearchListings.mockImplementation((q: Query) => {
        if (q.listingType === 'sale' && rowKind(q) === 'near-you')
          return new Promise((resolve) => (resolveNear = resolve));
        if (q.listingType === 'sale' && rowKind(q) === 'just-listed')
          return Promise.resolve(envelope(cards(1, 15)));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(linksIn('Newest homes for sale').has(pid(1))).toBe(true));
      resolveNear(envelope(cards(1, 15)));
      await waitFor(() => expect(linksIn('Newest homes for sale').has(pid(1))).toBe(false));
      expect(linksIn('Newest homes for sale').has(pid(8))).toBe(true);
    });
  });

  describe('neighborhood requests after unmount (#915)', () => {
    it('sends no neighborhood request once the page is gone', async () => {
      let release: (value: { results: never[]; total: number }) => void = () => undefined;
      mockedGetNeighborhoods.mockReturnValue(new Promise((resolve) => (release = resolve)));
      const view = renderWithClient(<HomePageContent />);
      await waitFor(() => expect(mockedGetNeighborhoods).toHaveBeenCalled());

      view.unmount();
      const callsAtUnmount = mockedGetNeighborhoods.mock.calls.length;
      release({ results: [], total: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockedGetNeighborhoods.mock.calls.length).toBe(callsAtUnmount);
    });
  });

  describe('near you (#363)', () => {
    it('renders no row without a resolved region', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      await waitFor(() => {
        expect(screen.queryByText('Homes for sale near you')).not.toBeInTheDocument();
        expect(screen.queryByText('Rentals near you')).not.toBeInTheDocument();
      });
    });

    it('falls to the licensed market with a neutral title when there is no signal (#834)', async () => {
      mockMarkets.push({ city: 'Arlington', state: 'VA' });
      try {
        renderWithClient(<HomePageContent />);

        await waitFor(() =>
          expect(mockedSearchListings).toHaveBeenCalledWith(
            expect.objectContaining({ listingType: 'sale', city: 'Arlington', state: 'VA' }),
            expect.anything(),
          ),
        );
        expect(await screen.findByText('Homes for sale')).toBeInTheDocument();
        expect(screen.queryByText('Homes for sale near you')).not.toBeInTheDocument();
      } finally {
        mockMarkets.length = 0;
      }
    });

    it('renders "Homes for sale near you" first, scoped to the resolved region', async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(screen.getByText('Homes for sale near you')).toBeInTheDocument());
      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ listingType: 'sale', city: 'Rockville', state: 'MD' }),
          expect.anything(),
        ),
      );
      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ listingType: 'rent', city: 'Rockville', state: 'MD' }),
          expect.anything(),
        ),
      );

      const link = screen.getByText('Homes for sale near you').closest('a');
      expect(link).toHaveAttribute('href', '/rockville-md/homes-for-sale');
    });

    it('renders no row when the resolved region has no listings', async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });
      mockedSearchListings.mockImplementation((q: Query) => {
        if (rowKind(q) === 'near-you') return Promise.resolve(envelope([], 0));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      await waitFor(() => {
        expect(screen.queryByText('Homes for sale near you')).not.toBeInTheDocument();
        expect(screen.queryByText('Rentals near you')).not.toBeInTheDocument();
      });
    });

    // The route handler (`geo-region.spec.ts`) filters a non-US countryCode to `null`; the
    // component only ever sees the already-filtered value, so a `null` region is the observable
    // shape of that case at this layer.
    it('renders no row when the region resolves to null (a non-US country, at the route)', async () => {
      mockRegionFetch(null);
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      await waitFor(() =>
        expect(screen.queryByText('Homes for sale near you')).not.toBeInTheDocument(),
      );
    });

    it('moves "Rentals near you" to the top when the last search was rent', async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });
      window.localStorage.setItem(
        'recentSearches',
        JSON.stringify([{ display_name: 'Rockville, MD', listingType: 'rent' }]),
      );
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      const { container } = renderWithClient(<HomePageContent />);
      await screen.findByText('Newest homes for sale');
      await screen.findByText('Rentals near you');

      const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
      expect(headings.slice(0, 2)).toEqual(['Rentals near you', 'Homes for sale near you']);
    });

    it("adds the region to a price-sort row's query when no place has been searched", async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });

      renderWithClient(<HomePageContent />);

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ city: 'Rockville', state: 'MD', sort: 'price-asc' }),
          expect.anything(),
        ),
      );
    });

    it('adds the region to a neighborhoods request, ahead of the licensed-state requests', async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Columbia Heights');

      const calls = mockedGetNeighborhoods.mock.calls.map(
        ([q]) => q as { city?: string; state?: string },
      );
      const cityCall = calls.findIndex((q) => q.city === 'Rockville' && q.state === 'MD');
      const stateCall = calls.findIndex((q) => q.city === undefined && q.state === 'MD');
      const firstLicensedState = calls.findIndex((q) => q.state === 'DC');
      expect(cityCall).toBeGreaterThanOrEqual(0);
      expect(stateCall).toBeGreaterThan(cityCall);
      expect(firstLicensedState).toBeGreaterThan(stateCall);
    });
  });

  describe('explore neighborhoods (#393)', () => {
    it('renders tiles from the mocked response', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Columbia Heights')).toBeInTheDocument();
      expect(screen.getByText('Washington, DC')).toBeInTheDocument();
      expect(screen.getByText('207 for sale')).toBeInTheDocument();
      expect(screen.getByText('93 for rent')).toBeInTheDocument();
    });

    it('requests each licensed state in order, then a state-less request only if still short', async () => {
      mockedGetNeighborhoods.mockImplementation((query: { state?: string }) =>
        Promise.resolve(
          query.state
            ? {
                results: [neighborhoodRow({ state: query.state, name: `Place-${query.state}` })],
                total: 1,
              }
            : { results: [], total: 0 },
        ),
      );

      renderWithClient(<HomePageContent />);

      await screen.findByText('Place-MD');
      // First occurrence of each state: a repeated run must not change the order under test.
      const stateArgs = [...new Set(mockedGetNeighborhoods.mock.calls.map(([q]) => q.state))];
      expect(stateArgs).toEqual(['MD', 'DC', 'VA', undefined]);
    });

    it('links a tile to the all-types neighborhood search (#492)', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      renderWithClient(<HomePageContent />);

      const link = (await screen.findByText('Columbia Heights')).closest('a');
      expect(link).toHaveAttribute(
        'href',
        '/washington-dc/columbia-heights-neighborhood/homes-for-sale?type=all',
      );
    });

    it('links the chip and trailing tile to the grouped search with no region (#504)', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      renderWithClient(<HomePageContent />);

      await screen.findByText('Columbia Heights');
      expect(screen.getAllByLabelText('Explore neighborhoods — see all')[0]).toHaveAttribute(
        'href',
        '/homes-for-sale?type=all&groupBy=neighborhood',
      );
      expect(screen.getByTestId('neighborhood-see-all-tile')).toHaveAttribute(
        'href',
        '/homes-for-sale?type=all&groupBy=neighborhood',
      );
    });

    it('scopes the chip and trailing tile to the region (#504)', async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      renderWithClient(<HomePageContent />);

      await screen.findByText('Columbia Heights');
      const href = '/rockville-md/homes-for-sale?type=all&groupBy=neighborhood';
      expect(screen.getAllByLabelText('Explore neighborhoods — see all')[0]).toHaveAttribute(
        'href',
        href,
      );
      expect(screen.getByTestId('neighborhood-see-all-tile')).toHaveAttribute('href', href);
    });

    it('hides the section when the response is empty', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [], total: 0 });

      renderWithClient(<HomePageContent />);

      await screen.findByText('Cheapest homes for sale');
      await waitFor(() =>
        expect(screen.queryByText('Explore neighborhoods')).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId('neighborhood-see-all-tile')).not.toBeInTheDocument();
    });
  });

  describe('cheapest / priciest rows (#478)', () => {
    const priceCalls = (listingType: string) =>
      mockedSearchListings.mock.calls
        .map(([q]) => q as Query)
        .filter((q) => rowKind(q) === 'price-sort' && q.listingType === listingType);

    it('titles each row by its sort, defaulting to lowest first', async () => {
      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Cheapest homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Cheapest rentals')).toBeInTheDocument();
      expect(screen.queryByText('Priciest homes for sale')).not.toBeInTheDocument();
      await waitFor(() => expect(priceCalls('sale')[0]?.sort).toBe('price-asc'));
      await waitFor(() => expect(priceCalls('rent')[0]?.sort).toBe('price-asc'));
    });

    it('flips one row to the high-to-low sort and title, and leaves the other row alone', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      const [saleGroup] = screen.getAllByRole('group', { name: 'Sort by price' });
      const highest = saleGroup.querySelector('button:nth-of-type(2)') as HTMLButtonElement;
      const lowest = saleGroup.querySelector('button:nth-of-type(1)') as HTMLButtonElement;
      expect(lowest).toHaveAttribute('aria-pressed', 'true');
      expect(highest).toHaveAttribute('aria-pressed', 'false');

      await waitFor(() => expect(priceCalls('rent').length).toBeGreaterThan(0));
      mockedSearchListings.mockClear();
      fireEvent.click(highest);

      expect(await screen.findByText('Priciest homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Cheapest rentals')).toBeInTheDocument();
      expect(highest).toHaveAttribute('aria-pressed', 'true');
      expect(lowest).toHaveAttribute('aria-pressed', 'false');
      await waitFor(() => expect(priceCalls('sale').at(-1)?.sort).toBe('price-desc'));
      expect(priceCalls('rent')).toHaveLength(0);
    });

    it('labels each toggle as a group with two pressed-state buttons', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      const groups = screen.getAllByRole('group', { name: 'Sort by price' });
      expect(groups).toHaveLength(2);
      for (const group of groups) {
        expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
          'Lowest',
          'Highest',
        ]);
      }
    });

    it('uses the canonical selected-pill style, not a brand color', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      const [group] = screen.getAllByRole('group', { name: 'Sort by price' });
      const active = group.querySelector('[aria-pressed="true"]') as HTMLElement;
      expect(active.className).toContain('bg-ink text-white');
      expect(active.className).not.toContain('brand-900');
    });

    it('sends no price cap, only a data-quality floor that also drops a withheld price', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      for (const side of ['sale', 'rent']) {
        for (const q of priceCalls(side)) {
          expect(q).not.toHaveProperty('maxPrice');
          expect(q.minPrice).toBeGreaterThan(0);
        }
      }
    });

    it('links "See all" with the row sort, floor and home types', async () => {
      renderWithClient(<HomePageContent />);

      const link = (await screen.findByText('Cheapest homes for sale')).closest('a')!;
      const href = link.getAttribute('href')!;
      expect(href).toContain('sort=price-asc');
      expect(href).toContain('minPrice=5000');
      expect(href).toContain('propertyType=');
      expect(href).not.toContain('Land');
      expect(href).not.toContain('maxPrice');
    });

    it('excludes land from the homes row only', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      await waitFor(() => expect(priceCalls('sale').length).toBeGreaterThan(0));
      const [sale] = priceCalls('sale');
      expect(sale.propertyType).toContain('Single Family');
      expect(sale.propertyType).not.toContain('Land');
      expect(priceCalls('rent')[0]).not.toHaveProperty('propertyType');
    });

    it('shows the row skeleton cards while a toggle refetches', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      mockedSearchListings.mockImplementation(() => new Promise(() => {}));
      const [saleGroup] = screen.getAllByRole('group', { name: 'Sort by price' });
      fireEvent.click(saleGroup.querySelector('button:nth-of-type(2)') as HTMLButtonElement);

      const row = (await screen.findByText('Priciest homes for sale')).closest('section')!;
      await waitFor(() =>
        expect(row.querySelectorAll('[data-skeleton-card]').length).toBeGreaterThan(0),
      );
    });

    it('hides a row whose settled result is empty', async () => {
      mockedSearchListings.mockImplementation((q: Query) =>
        Promise.resolve(
          rowKind(q) === 'price-sort' ? envelope([], 0) : envelope([aListingCardRow()]),
        ),
      );
      renderWithClient(<HomePageContent />);

      await screen.findByText('Newest homes for sale');
      await waitFor(() => expect(screen.queryByText('Cheapest rentals')).not.toBeInTheDocument());
    });
  });

  describe('resilience', () => {
    it('fires every row query in parallel rather than one after another', async () => {
      mockedSearchListings.mockReturnValue(new Promise(() => {})); // never resolves
      renderWithClient(<HomePageContent />);

      // Just listed (x2 sides), coming soon (x2 sides), price drops, and two price-sort rows.
      await waitFor(() => expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(6));
    });

    it('degrades gracefully when one row fails — the rest of the page still renders, with its own retry', async () => {
      mockedSearchListings.mockImplementation((q: Query) => {
        if (rowKind(q) === 'coming-soon')
          return Promise.reject(new Error('coming-soon row is down'));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(screen.getAllByText('Failed to load').length).toBeGreaterThan(0));
      expect(screen.getAllByRole('button', { name: 'Tap to retry' }).length).toBeGreaterThan(0);
      expect(await screen.findByText('Cheapest homes for sale')).toBeInTheDocument();
    });
  });

  describe('removed rows', () => {
    it('renders none of the retired carousels', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      for (const title of [
        'Featured homes for sale',
        'Featured homes for rent',
        'Popular homes for sale',
        'Available homes for rent',
        'Luxury collection for sale',
        'Luxury homes for rent',
      ]) {
        expect(screen.queryByText(title)).not.toBeInTheDocument();
      }
    });
  });

  describe('compliance', () => {
    it('uses no banned Fair-Housing-adjacent word anywhere in the rendered body', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      const banned =
        /\b(popular|trending|best|hot|exclusive|selling fast|hand-picked|featured|safe|family|young professionals|student|up-and-coming|dream|perfect for|ideal for)\b/i;
      expect(document.body.textContent).not.toMatch(banned);
    });

    it('makes no savings or deal claim on the price-drops row', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Price drops on homes for sale');

      expect(document.body.textContent).not.toMatch(/\bsave\b|\bsaved\b|% off|\bdeal\b/i);
    });

    it('never names "MLS" or "IDX" anywhere on the page', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');
      expect(document.body.textContent).not.toMatch(/\bMLS\b|\bIDX\b/);
    });

    it('removes the unsourced brokerage claims and keeps the trust block fact-only', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(
        screen.getByText('Cribstop is brokered by Real Broker LLC, licensed in MD, DC, and VA.'),
      ).toBeInTheDocument();
    });

    it('titles the trust block with the one fact it can back — freshness', async () => {
      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText(/^Real listings, updated /)).toBeInTheDocument();
    });

    it('falls back to a plain, fact-backed trust-block title when freshness is not known yet', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: null,
        sources: ['internal'],
        listingCount: 13,
      });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText('Real, licensed listings')).toBeInTheDocument();
    });

    it('shows an "Updated" freshness tile from dataUpdatedAt', async () => {
      renderWithClient(<HomePageContent />);
      await waitFor(() => expect(screen.getByText('Updated')).toBeInTheDocument());
    });

    it('omits the "Updated" tile when dataUpdatedAt is null', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: null,
        sources: ['internal'],
        listingCount: 13,
      });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');
      expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    });

    /** #438. "Updated X ago" is the last successful sync, never the newest listing timestamp. */
    it('prefers lastSyncedAt over dataUpdatedAt for the "Updated" freshness tile', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedAt: '2026-04-20T18:00:00.000Z',
        sources: ['internal'],
        listingCount: 13,
      });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      // Both are months old at test time, but lastSyncedAt is the newer of the two, so it must be
      // what the relative-time text is computed from.
      expect(screen.getByText(/^Real listings, updated /)).toBeInTheDocument();
    });

    it('falls back to dataUpdatedAt when lastSyncedAt is absent (older deployment)', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: '2026-04-20T18:00:00.000Z',
        sources: ['internal'],
        listingCount: 13,
      });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText(/^Real listings, updated /)).toBeInTheDocument();
    });

    it('falls back to dataUpdatedAt when lastSyncedAt is null (no sync run has succeeded yet)', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: '2026-04-20T18:00:00.000Z',
        lastSyncedAt: null,
        sources: ['internal'],
        listingCount: 13,
      });

      renderWithClient(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText(/^Real listings, updated /)).toBeInTheDocument();
    });
  });

  describe('saved listings row (#364)', () => {
    const TITLE = 'More homes in Rockville';
    const savedHome = (listing: ReturnType<typeof aListingCardRow> | null) => ({
      propertyId: 'p-saved',
      listing,
    });

    it('renders for a signed-in user with saves, queried from the latest save', async () => {
      mockUser = { email: 'a@b.co' };
      mockSavedIds = new Set(['p-saved']);
      mockedRecentSaved.mockResolvedValue([
        savedHome(
          aListingCardRow({
            city: 'Rockville',
            state: 'MD',
            propertyType: 'Condo',
            listingType: 'rent',
          }),
        ),
        savedHome(aListingCardRow({ city: 'Older', state: 'VA' })),
      ]);

      renderWithClient(<HomePageContent />);

      await waitFor(() => expect(mockedRecentSaved).toHaveBeenCalled());
      expect(await screen.findByText(TITLE)).toBeInTheDocument();
      const call = mockedSearchListings.mock.calls.find(([q]) => q.propertyType?.includes('Condo'));
      expect(call?.[0]).toMatchObject({
        city: 'Rockville',
        state: 'MD',
        propertyType: ['Condo'],
        listingType: 'rent',
        pageSize: 8,
        skipTotal: true,
      });
    });

    it('is absent and makes no saved call when signed out', async () => {
      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
      expect(mockedRecentSaved).not.toHaveBeenCalled();
    });

    it('is absent with zero saves and runs no fallback query', async () => {
      mockUser = { email: 'a@b.co' };
      mockedRecentSaved.mockResolvedValue([]);

      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      await waitFor(() => expect(mockedRecentSaved).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
      expect(mockedSearchListings.mock.calls.some(([q]) => q.propertyType && !q.sort)).toBe(false);
    });

    it('hides the row, not the page, when the saved read fails', async () => {
      mockUser = { email: 'a@b.co' };
      mockedRecentSaved.mockRejectedValue(new Error('503'));

      renderWithClient(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
    });
  });
});
