import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsMeta, searchListings } from '@/lib/api/listings';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
}));

// HomePageContent itself does not read useApp()/listingType (#361, #392) — but ListingCard,
// rendered inside every carousel row, still calls useApp() for save/unsave. Without this mock the
// cards throw for lack of a react-redux Provider, unrelated to what this file is testing.
let mockedGlobalListingType: 'sale' | 'rent' = 'sale';
jest.mock('@/lib/context', () => ({
  useApp: () => ({
    listingType: mockedGlobalListingType,
    toggleSave: jest.fn(),
    isSaved: () => false,
  }),
}));

// Overrides the app-wide `useSearchParams` stub from jest.setup.ts (which always returns an empty
// URLSearchParams) so the `?show=` tests can drive it. Mirrors NavBar.spec.tsx's own override.
let mockedSearchParams = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockedSearchParams),
}));

const mockedSearchListings = searchListings as jest.Mock;
const mockedGetListingsMeta = getListingsMeta as jest.Mock;

const INTENT_STORAGE_KEY = 'cribstop:home-intent';

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

/**
 * The most recent query with a `status` filter is the "Coming soon" row — every other row omits
 * it. The *most recent* one, not the first: the row re-fetches once the intent control's effect
 * resolves a `?show=` override or a persisted `localStorage` pick, after firing its initial
 * "Both" query on first paint.
 */
function comingSoonQuery(): { listingType?: string } | undefined {
  const calls = mockedSearchListings.mock.calls.filter(
    ([q]) => (q as { status?: string[] }).status,
  );
  return calls.at(-1)?.[0];
}

describe('HomePageContent', () => {
  beforeEach(() => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['internal'],
      listingCount: 13,
    });
    mockedSearchListings.mockResolvedValue(envelope([aListingCardRow()]));
  });

  afterEach(() => {
    mockedSearchListings.mockReset();
    mockedGetListingsMeta.mockReset();
    mockedGlobalListingType = 'sale';
    mockedSearchParams = '';
    window.localStorage.clear();
  });

  describe('intent control (#392)', () => {
    it('defaults to "Both": queries the coming-soon row with "all" and shows both budget sub-rows', async () => {
      render(<HomePageContent />);

      const both = await screen.findByRole('radio', { name: 'Both' });
      expect(both).toHaveAttribute('aria-checked', 'true');

      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'all' }));
      expect(await screen.findByText('Homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Homes for rent')).toBeInTheDocument();
    });

    it('honors a `?show=` override on load, overriding the "Both" default', async () => {
      mockedSearchParams = 'show=rent';
      render(<HomePageContent />);

      const rentOption = await screen.findByRole('radio', { name: 'For rent' });
      await waitFor(() => expect(rentOption).toHaveAttribute('aria-checked', 'true'));
      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'rent' }));
      expect(await screen.findByText('Homes for rent')).toBeInTheDocument();
      expect(screen.queryByText('Homes for sale')).not.toBeInTheDocument();
    });

    it('is keyboard operable and exposes role="radiogroup" with a visible focus ring', async () => {
      render(<HomePageContent />);
      const group = await screen.findByRole('radiogroup');
      expect(group).toBeInTheDocument();

      const forSale = screen.getByRole('radio', { name: 'For sale' });
      expect(forSale.tagName).toBe('BUTTON');
      forSale.focus();
      expect(forSale).toHaveFocus();
      expect(forSale.className).toMatch(/focus-visible:ring/);
    });

    it('persists a manual pick to localStorage and reads it back on the next visit', async () => {
      const { unmount } = render(<HomePageContent />);
      const forSale = await screen.findByRole('radio', { name: 'For sale' });
      fireEvent.click(forSale);

      await waitFor(() => expect(window.localStorage.getItem(INTENT_STORAGE_KEY)).toBe('sale'));
      unmount();

      mockedSearchListings.mockClear();
      render(<HomePageContent />);
      const forSaleAgain = await screen.findByRole('radio', { name: 'For sale' });
      await waitFor(() => expect(forSaleAgain).toHaveAttribute('aria-checked', 'true'));
      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'sale' }));
      expect(screen.getByText('Homes for sale')).toBeInTheDocument();
      expect(screen.queryByText('Homes for rent')).not.toBeInTheDocument();
    });

    it('each mode issues the expected listingType on the coming-soon row', async () => {
      render(<HomePageContent />);
      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'all' }));

      mockedSearchListings.mockClear();
      fireEvent.click(await screen.findByRole('radio', { name: 'For rent' }));
      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'rent' }));

      mockedSearchListings.mockClear();
      fireEvent.click(await screen.findByRole('radio', { name: 'For sale' }));
      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'sale' }));
    });

    it('never reads or writes the search bar’s global listingType (#361)', async () => {
      mockedGlobalListingType = 'rent';
      render(<HomePageContent />);

      // Still defaults to "Both" — untouched by the search bar's own state.
      expect(await screen.findByRole('radio', { name: 'Both' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await waitFor(() => expect(comingSoonQuery()).toMatchObject({ listingType: 'all' }));
    });
  });

  describe('coming soon row (#392)', () => {
    it('renders the envelope total in the subtitle', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) {
          return Promise.resolve(envelope([aListingCardRow()], 3041));
        }
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      render(<HomePageContent />);

      expect(await screen.findByText('Coming soon')).toBeInTheDocument();
      expect(
        await screen.findByText('3,041 listed early. Showings have not started.'),
      ).toBeInTheDocument();
    });

    it('is hidden when the total is 0 and the fetch has settled', async () => {
      mockedSearchListings.mockImplementation((query: { status?: string[] }) => {
        if (query.status?.includes('Coming Soon')) return Promise.resolve(envelope([], 0));
        return Promise.resolve(envelope([aListingCardRow()]));
      });

      render(<HomePageContent />);

      await screen.findByText('What your budget buys');
      expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    });
  });

  describe('what your budget buys (#392)', () => {
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

    it('renders one sub-row per listing type when the intent is "Both"', async () => {
      render(<HomePageContent />);

      await screen.findByText('What your budget buys');
      expect(screen.getByText('Homes for sale')).toBeInTheDocument();
      expect(screen.getByText('Homes for rent')).toBeInTheDocument();
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

      // Coming soon + the sale and rent budget sub-rows — three independent fetches on the same
      // tick, none gated behind another's result.
      expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(3);
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
        expect(screen.getByText('7 listed early. Showings have not started.')).toBeInTheDocument(),
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

      await waitFor(() => expect(screen.getByText('Coming soon')).toBeInTheDocument());
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tap to retry' })).toBeInTheDocument();
      // The rest of the page is unaffected by the failed row.
      expect(await screen.findByText('What your budget buys')).toBeInTheDocument();
      expect(screen.getByText('Homes for sale')).toBeInTheDocument();
    });
  });

  describe('removed rows (#392)', () => {
    it('renders none of the retired carousels', async () => {
      render(<HomePageContent />);
      await screen.findByText('What your budget buys');

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
      await screen.findByText('What your budget buys');

      const banned =
        /\b(popular|trending|best|hand-picked|featured|safe|family|young professionals|student|up-and-coming)\b/i;
      expect(document.body.textContent).not.toMatch(banned);
    });

    it('removes the unsourced brokerage claims and keeps the block fact-only', async () => {
      render(<HomePageContent />);
      await screen.findByText('What your budget buys');

      expect(
        screen.queryByText(/Trusted by buyers, sellers, and renters across the DMV/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/one of the fastest-growing brokerages in the country/),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/Brokered by Real Broker LLC\./)).toBeInTheDocument();
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
      await screen.findByText('What your budget buys');
      expect(screen.queryByText('Updated')).not.toBeInTheDocument();
    });
  });
});
