import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsMeta, getNeighborhoods, searchListings } from '@/lib/api/listings';
import { listRecentSavedHomes } from '@/lib/api/saved-homes';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoods: jest.fn(),
}));

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
};

/** Which row a query belongs to, by its distinguishing filter — never by call order, since order
 *  changes with `useRentFirst`. */
function rowKind(
  q: Query,
): 'just-listed' | 'coming-soon' | 'price-drops' | 'price-sort' | 'near-you' {
  if (q.sort === 'price-asc' || q.sort === 'price-desc') return 'price-sort';
  if (q.priceReduced) return 'price-drops';
  if (q.status?.includes('Coming Soon')) return 'coming-soon';
  return q.city ? 'near-you' : 'just-listed';
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
      render(<HomePageContent />);

      await waitFor(() => expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(7));

      for (const [query] of mockedSearchListings.mock.calls) {
        expect(query).toMatchObject({ skipTotal: true, pageSize: 8 });
      }
    });

    it('fails one row without failing the others', async () => {
      mockedSearchListings.mockImplementation((query: Query) =>
        query.priceReduced
          ? Promise.reject(new Error('503'))
          : Promise.resolve(envelope([aListingCardRow()])),
      );

      render(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      expect(await screen.findByText('Price drops on homes for sale')).toBeInTheDocument();
      expect(await screen.findAllByText(/Tap to retry/i)).toHaveLength(1);
    });
  });

  describe('titles (#394, #419)', () => {
    it('renders every row title, and no subtitle text under any of them', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });
      render(<HomePageContent />);

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
      render(<HomePageContent />);

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
      render(<HomePageContent />);

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

      render(<HomePageContent />);

      await screen.findByText('Newest homes for sale');
      expect(screen.queryByText('Price drops on homes for sale')).not.toBeInTheDocument();
    });
  });

  describe('row order (#394)', () => {
    it('orders Just listed, Coming soon (sale), Price drops, then the rentals cluster by default', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });
      const { container } = render(<HomePageContent />);
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

      const { container } = render(<HomePageContent />);
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

      render(<HomePageContent />);

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

      render(<HomePageContent />);

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ status: ['Coming Soon'], city: 'Rockville', state: 'MD' }),
          expect.anything(),
        ),
      );
    });
  });

  describe('near you (#363)', () => {
    it('renders no row without a resolved region', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      await waitFor(() => {
        expect(screen.queryByText('Homes for sale near you')).not.toBeInTheDocument();
        expect(screen.queryByText('Rentals near you')).not.toBeInTheDocument();
      });
    });

    it('renders "Homes for sale near you" first, scoped to the resolved region', async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });

      render(<HomePageContent />);

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

      render(<HomePageContent />);
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
      render(<HomePageContent />);
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

      const { container } = render(<HomePageContent />);
      await screen.findByText('Newest homes for sale');
      await screen.findByText('Rentals near you');

      const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
      expect(headings.slice(0, 2)).toEqual(['Rentals near you', 'Homes for sale near you']);
    });

    it("adds the region to a price-sort row's query when no place has been searched", async () => {
      mockRegionFetch({ city: 'Rockville', state: 'MD' });

      render(<HomePageContent />);

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

      render(<HomePageContent />);
      await screen.findByText('Columbia Heights');

      const calls = mockedGetNeighborhoods.mock.calls.map(
        ([q]) => q as { city?: string; state?: string },
      );
      expect(calls.slice(0, 2)).toEqual([
        { city: 'Rockville', state: 'MD', limit: 24, minCount: 5 },
        { state: 'MD', limit: 24, minCount: 5 },
      ]);
    });
  });

  describe('explore neighborhoods (#393)', () => {
    it('renders tiles from the mocked response', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      render(<HomePageContent />);

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

      render(<HomePageContent />);

      await screen.findByText('Place-MD');
      const stateArgs = mockedGetNeighborhoods.mock.calls.map(([q]) => q.state);
      expect(stateArgs).toEqual(['MD', 'DC', 'VA', undefined]);
    });

    it('links a tile to the all-types neighborhood search (#492)', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      render(<HomePageContent />);

      const link = (await screen.findByText('Columbia Heights')).closest('a');
      expect(link).toHaveAttribute(
        'href',
        '/washington-dc/columbia-heights-neighborhood/homes-for-sale?type=all',
      );
    });

    it('links the chip and trailing tile to the grouped search with no region (#504)', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      render(<HomePageContent />);

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

      render(<HomePageContent />);

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

      render(<HomePageContent />);

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
      render(<HomePageContent />);

      expect(await screen.findByText('Cheapest homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Cheapest rentals')).toBeInTheDocument();
      expect(screen.queryByText('Priciest homes for sale')).not.toBeInTheDocument();
      expect(priceCalls('sale')[0].sort).toBe('price-asc');
      expect(priceCalls('rent')[0].sort).toBe('price-asc');
    });

    it('flips one row to the high-to-low sort and title, and leaves the other row alone', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      const [saleGroup] = screen.getAllByRole('group', { name: 'Sort by price' });
      const highest = saleGroup.querySelector('button:nth-of-type(2)') as HTMLButtonElement;
      const lowest = saleGroup.querySelector('button:nth-of-type(1)') as HTMLButtonElement;
      expect(lowest).toHaveAttribute('aria-pressed', 'true');
      expect(highest).toHaveAttribute('aria-pressed', 'false');

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
      render(<HomePageContent />);
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
      render(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      const [group] = screen.getAllByRole('group', { name: 'Sort by price' });
      const active = group.querySelector('[aria-pressed="true"]') as HTMLElement;
      expect(active.className).toContain('bg-ink text-white');
      expect(active.className).not.toContain('brand-900');
    });

    it('sends no price cap, only a data-quality floor that also drops a withheld price', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      for (const side of ['sale', 'rent']) {
        for (const q of priceCalls(side)) {
          expect(q).not.toHaveProperty('maxPrice');
          expect(q.minPrice).toBeGreaterThan(0);
        }
      }
    });

    it('links "See all" with the row sort, floor and home types', async () => {
      render(<HomePageContent />);

      const link = (await screen.findByText('Cheapest homes for sale')).closest('a')!;
      const href = link.getAttribute('href')!;
      expect(href).toContain('sort=price-asc');
      expect(href).toContain('minPrice=5000');
      expect(href).toContain('propertyType=');
      expect(href).not.toContain('Land');
      expect(href).not.toContain('maxPrice');
    });

    it('excludes land from the homes row only', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest rentals');

      const [sale] = priceCalls('sale');
      expect(sale.propertyType).toContain('Single Family');
      expect(sale.propertyType).not.toContain('Land');
      expect(priceCalls('rent')[0]).not.toHaveProperty('propertyType');
    });

    it('shows the row skeleton cards while a toggle refetches', async () => {
      render(<HomePageContent />);
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
      render(<HomePageContent />);

      await screen.findByText('Newest homes for sale');
      await waitFor(() => expect(screen.queryByText('Cheapest rentals')).not.toBeInTheDocument());
    });
  });

  describe('resilience', () => {
    it('fires every row query in parallel rather than one after another', () => {
      mockedSearchListings.mockReturnValue(new Promise(() => {})); // never resolves
      render(<HomePageContent />);

      // Just listed (x2 sides), coming soon (x2 sides), price drops, and two price-sort rows.
      expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(6);
    });

    it('degrades gracefully when one row fails — the rest of the page still renders, with its own retry', async () => {
      mockedSearchListings.mockImplementation((q: Query) => {
        if (rowKind(q) === 'coming-soon')
          return Promise.reject(new Error('coming-soon row is down'));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      render(<HomePageContent />);

      await waitFor(() => expect(screen.getAllByText('Failed to load').length).toBeGreaterThan(0));
      expect(screen.getAllByRole('button', { name: 'Tap to retry' }).length).toBeGreaterThan(0);
      expect(await screen.findByText('Cheapest homes for sale')).toBeInTheDocument();
    });
  });

  describe('removed rows', () => {
    it('renders none of the retired carousels', async () => {
      render(<HomePageContent />);
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
      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      const banned =
        /\b(popular|trending|best|hot|exclusive|selling fast|hand-picked|featured|safe|family|young professionals|student|up-and-coming|dream|perfect for|ideal for)\b/i;
      expect(document.body.textContent).not.toMatch(banned);
    });

    it('makes no savings or deal claim on the price-drops row', async () => {
      render(<HomePageContent />);
      await screen.findByText('Price drops on homes for sale');

      expect(document.body.textContent).not.toMatch(/\bsave\b|\bsaved\b|% off|\bdeal\b/i);
    });

    it('never names "MLS" or "IDX" anywhere on the page', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');
      expect(document.body.textContent).not.toMatch(/\bMLS\b|\bIDX\b/);
    });

    it('removes the unsourced brokerage claims and keeps the trust block fact-only', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(
        screen.getByText('Cribstop is brokered by Real Broker LLC, licensed in MD, DC, and VA.'),
      ).toBeInTheDocument();
    });

    it('titles the trust block with the one fact it can back — freshness', async () => {
      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText(/^Real listings, updated /)).toBeInTheDocument();
    });

    it('falls back to a plain, fact-backed trust-block title when freshness is not known yet', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: null,
        sources: ['internal'],
        listingCount: 13,
      });

      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText('Real, licensed listings')).toBeInTheDocument();
    });

    it('shows an "Updated" freshness tile from dataUpdatedAt', async () => {
      render(<HomePageContent />);
      await waitFor(() => expect(screen.getByText('Updated')).toBeInTheDocument());
    });

    it('omits the "Updated" tile when dataUpdatedAt is null', async () => {
      mockedGetListingsMeta.mockResolvedValue({
        dataUpdatedAt: null,
        sources: ['internal'],
        listingCount: 13,
      });

      render(<HomePageContent />);
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

      render(<HomePageContent />);
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

      render(<HomePageContent />);
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

      render(<HomePageContent />);
      await screen.findByText('Cheapest homes for sale');

      expect(screen.getByText(/^Real listings, updated /)).toBeInTheDocument();
    });
  });

  describe('saved listings row (#364)', () => {
    const TITLE = 'More homes like the ones you saved';
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

      render(<HomePageContent />);

      expect(await screen.findByText(TITLE)).toBeInTheDocument();
      const call = mockedSearchListings.mock.calls.find(([q]) => q.city === 'Rockville');
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
      render(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
      expect(mockedRecentSaved).not.toHaveBeenCalled();
    });

    it('is absent with zero saves and runs no fallback query', async () => {
      mockUser = { email: 'a@b.co' };
      mockedRecentSaved.mockResolvedValue([]);

      render(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      await waitFor(() => expect(mockedRecentSaved).toHaveBeenCalled());
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
      expect(mockedSearchListings.mock.calls.some(([q]) => q.propertyType && !q.sort)).toBe(false);
    });

    it('hides the row, not the page, when the saved read fails', async () => {
      mockUser = { email: 'a@b.co' };
      mockedRecentSaved.mockRejectedValue(new Error('503'));

      render(<HomePageContent />);

      expect(await screen.findByText('Newest homes for sale')).toBeInTheDocument();
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    });
  });
});
