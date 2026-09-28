import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsMeta, getNeighborhoods, searchListings } from '@/lib/api/listings';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoods: jest.fn(),
}));

// HomePageContent itself does not read useApp()/listingType (#361, #392) — but ListingCard,
// rendered inside every carousel row, still calls useApp() for save/unsave. Without this mock the
// cards throw for lack of a react-redux Provider, unrelated to what this file is testing.
jest.mock('@/lib/context', () => ({
  useApp: () => ({
    listingType: 'sale',
    toggleSave: jest.fn(),
    isSaved: () => false,
  }),
}));

const mockedSearchListings = searchListings as jest.Mock;
const mockedGetListingsMeta = getListingsMeta as jest.Mock;
const mockedGetNeighborhoods = getNeighborhoods as jest.Mock;

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

/** Every "Coming soon" query, in call order — one per section (#398 always renders both). */
function comingSoonQueries(): { listingType?: string }[] {
  return mockedSearchListings.mock.calls
    .map(([q]) => q as { status?: string[]; listingType?: string })
    .filter((q) => q.status);
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
  });

  afterEach(() => {
    mockedSearchListings.mockReset();
    mockedGetListingsMeta.mockReset();
    mockedGetNeighborhoods.mockReset();
    window.localStorage.clear();
  });

  describe('sale/rent sections (#398)', () => {
    it('always shows both a for-sale and a for-rent coming-soon section, sale first by default', async () => {
      render(<HomePageContent />);

      await waitFor(() => expect(comingSoonQueries().length).toBe(2));
      expect(comingSoonQueries()[0]).toMatchObject({ listingType: 'sale' });
      expect(comingSoonQueries()[1]).toMatchObject({ listingType: 'rent' });
    });

    it('orders rent first when the visitor last searched rent', async () => {
      // Call order stays sale-then-rent (each side mounts once and never re-fetches on reorder —
      // React matches the two coming-soon rows by their `side` key, not by JSX position). The
      // visible order is what #398 asks for, so this checks the rendered "See all" link order.
      window.localStorage.setItem(
        'recentSearches',
        JSON.stringify([{ display_name: 'Baltimore, MD', listingType: 'rent' }]),
      );

      const { container } = render(<HomePageContent />);

      await waitFor(() => {
        const links = Array.from(container.querySelectorAll('a[aria-label="See all"]'));
        expect(links.length).toBeGreaterThanOrEqual(2);
        expect(links[0].getAttribute('href')).toContain('homes-for-rent');
        expect(links[1].getAttribute('href')).toContain('homes-for-sale');
      });
    });

    it('renders no selection control for intent', async () => {
      render(<HomePageContent />);
      await screen.findByText('What under $300K gets you');
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    });
  });

  describe('coming soon row (#392, #416)', () => {
    it('renders per-side titles and the envelope total in the subtitle', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) {
          return Promise.resolve(envelope([aListingCardRow()], 3041));
        }
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      render(<HomePageContent />);

      expect(await screen.findByText('Dropping soon')).toBeInTheDocument();
      expect(screen.getByText('Rentals about to drop')).toBeInTheDocument();
      expect(
        await screen.findByText('Sneak peek at 3,041 homes for sale coming soon'),
      ).toBeInTheDocument();
      expect(screen.getByText('3,041 rentals coming soon. See them first.')).toBeInTheDocument();
    });

    it('is hidden when the total is 0 and the fetch has settled', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) return Promise.resolve(envelope([], 0));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      render(<HomePageContent />);

      await screen.findByText('What under $300K gets you');
      expect(screen.queryByText('Dropping soon')).not.toBeInTheDocument();
      expect(screen.queryByText('Rentals about to drop')).not.toBeInTheDocument();
    });
  });

  describe('explore neighborhoods (#393)', () => {
    it('renders tiles from the mocked response', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      render(<HomePageContent />);

      expect(await screen.findByText('Columbia Heights')).toBeInTheDocument();
      expect(screen.getByText('Washington, DC')).toBeInTheDocument();
      expect(screen.getByText('207 for sale · 93 for rent')).toBeInTheDocument();
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
      // MD, DC, VA (licensed order), then one state-less request because 3 rows is still short of 8.
      expect(stateArgs).toEqual(['MD', 'DC', 'VA', undefined]);
    });

    it('omits the zero count part on a tile', async () => {
      mockedGetNeighborhoods.mockResolvedValue({
        results: [neighborhoodRow({ name: 'Petworth', sale: 40, rent: 0 })],
        total: 1,
      });

      render(<HomePageContent />);

      expect(await screen.findByText('40 for sale')).toBeInTheDocument();
      expect(screen.queryByText(/\d+ for rent/)).not.toBeInTheDocument();
    });

    it('links a tile to the neighborhood search path', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [neighborhoodRow()], total: 1 });

      render(<HomePageContent />);

      const link = (await screen.findByText('Columbia Heights')).closest('a');
      expect(link).toHaveAttribute(
        'href',
        '/washington-dc/columbia-heights-neighborhood/homes-for-sale',
      );
    });

    it('hides the section when the response is empty', async () => {
      mockedGetNeighborhoods.mockResolvedValue({ results: [], total: 0 });

      render(<HomePageContent />);

      await screen.findByText('What under $300K gets you');
      expect(screen.queryByText('Pick your neighborhood')).not.toBeInTheDocument();
    });

    it('hides the section when the fetch fails', async () => {
      mockedGetNeighborhoods.mockRejectedValue(new Error('down'));

      render(<HomePageContent />);

      await screen.findByText('What under $300K gets you');
      expect(screen.queryByText('Pick your neighborhood')).not.toBeInTheDocument();
    });
  });

  describe('what your budget buys (#392, #416)', () => {
    it('fetches only the selected chip, and changing it re-fetches with the new band', async () => {
      render(<HomePageContent />);

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ listingType: 'sale', maxPrice: 300_000 }),
          expect.anything(),
        ),
      );
      expect(mockedSearchListings).not.toHaveBeenCalledWith(
        expect.objectContaining({ listingType: 'sale', minPrice: 300_000, maxPrice: 500_000 }),
        expect.anything(),
      );

      mockedSearchListings.mockClear();
      fireEvent.click(await screen.findByRole('button', { name: '$300K–$500K' }));

      await waitFor(() =>
        expect(mockedSearchListings).toHaveBeenCalledWith(
          expect.objectContaining({ listingType: 'sale', minPrice: 300_000, maxPrice: 500_000 }),
          expect.anything(),
        ),
      );
    });

    it('renders one sub-row per listing type, each titled after its own default band', async () => {
      render(<HomePageContent />);

      expect(await screen.findByText('What under $300K gets you')).toBeInTheDocument();
      expect(screen.getByText('What under $1,500 gets you')).toBeInTheDocument();
    });

    it('re-titles a sub-row when its chip changes', async () => {
      render(<HomePageContent />);

      await screen.findByText('What under $300K gets you');
      fireEvent.click(await screen.findByRole('button', { name: '$300K–$500K' }));
      expect(await screen.findByText('What $300K–$500K gets you')).toBeInTheDocument();
    });

    it('uses the canonical selected-chip style, not a brand color', async () => {
      render(<HomePageContent />);
      await screen.findByText('What under $300K gets you');

      const active = await screen.findByRole('button', { name: 'Under $300K' });
      expect(active.className).toContain('border-ink bg-ink text-white');
      expect(active.className).not.toContain('brand-900');
    });

    it('keeps the chips live and shows a plain empty message for a band with no matches', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) return Promise.resolve(envelope([]));
        return Promise.resolve(envelope([], 0));
      });

      render(<HomePageContent />);

      // Both budget sub-rows are empty at their default (first) chip.
      const empty = await screen.findAllByText(
        'No homes in this price range yet. Try another range.',
      );
      expect(empty).toHaveLength(2);
      // The chips stay usable so the visitor can pick another range.
      expect(screen.getByRole('button', { name: '$300K–$500K' })).toBeInTheDocument();
    });
  });

  describe('resilience (#392)', () => {
    it('fires every row query in parallel rather than one after another', () => {
      mockedSearchListings.mockReturnValue(new Promise(() => {})); // never resolves
      render(<HomePageContent />);

      // Sale + rent coming-soon, sale + rent budget sub-rows — four independent fetches on the
      // same tick, none gated behind another's result.
      expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('renders one row once its own fetch resolves, even while others are still pending', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) {
          return Promise.resolve(envelope([aListingCardRow()], 7));
        }
        return new Promise(() => {}); // the budget rows never resolve in this test
      });

      render(<HomePageContent />);

      await waitFor(() =>
        expect(
          screen.getAllByText('Sneak peek at 7 homes for sale coming soon').length,
        ).toBeGreaterThan(0),
      );
    });

    it('degrades gracefully when one row fails — the rest of the page still renders, with its own retry', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) {
          return Promise.reject(new Error('coming-soon row is down'));
        }
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      render(<HomePageContent />);

      await waitFor(() => expect(screen.getAllByText('Failed to load').length).toBeGreaterThan(0));
      expect(screen.getAllByRole('button', { name: 'Tap to retry' }).length).toBeGreaterThan(0);
      // The rest of the page is unaffected by the failed rows.
      expect(await screen.findByText('What under $300K gets you')).toBeInTheDocument();
      expect(screen.getByText('What under $1,500 gets you')).toBeInTheDocument();
    });
  });

  describe('removed rows (#392)', () => {
    it('renders none of the retired carousels', async () => {
      render(<HomePageContent />);
      await screen.findByText('What under $300K gets you');

      for (const title of [
        'Featured homes for sale',
        'Featured homes for rent',
        'Popular homes for sale',
        'Available homes for rent',
        'Luxury collection for sale',
        'Luxury homes for rent',
        'Just listed homes for sale',
        'Just listed homes for rent',
      ]) {
        expect(screen.queryByText(title)).not.toBeInTheDocument();
      }
    });
  });

  describe('compliance (#392)', () => {
    it('uses no banned Fair-Housing-adjacent word anywhere in the rendered body', async () => {
      render(<HomePageContent />);
      await screen.findByText('What under $300K gets you');

      const banned =
        /\b(popular|trending|best|hot|exclusive|selling fast|hand-picked|featured|safe|family|young professionals|student|up-and-coming)\b/i;
      expect(document.body.textContent).not.toMatch(banned);
    });

    it('removes the unsourced brokerage claims and keeps the block fact-only', async () => {
      render(<HomePageContent />);
      await screen.findByText('What under $300K gets you');

      expect(
        screen.queryByText(/Trusted by buyers, sellers, and renters across the DMV/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/one of the fastest-growing brokerages in the country/),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/Every listing, brokered by Real Broker LLC\./)).toBeInTheDocument();
      expect(screen.getByText(/licensed in MD, DC, and VA/)).toBeInTheDocument();
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
      await screen.findByText('What under $300K gets you');
      expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    });
  });
});
