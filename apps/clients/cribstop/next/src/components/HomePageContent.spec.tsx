import { render, screen, waitFor } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { getListingsMeta, searchListings } from '@/lib/api/listings';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
}));

jest.mock('@/lib/context', () => ({
  useApp: () => ({ listingType: 'sale', toggleSave: jest.fn(), isSaved: () => false }),
}));

const mockedSearchListings = searchListings as jest.Mock;
const mockedGetListingsMeta = getListingsMeta as jest.Mock;

function envelope(rows: ReturnType<typeof aListingCardRow>[]) {
  return {
    results: rows,
    total: rows.length,
    page: 1,
    pageSize: 8,
    pageCount: 1,
    appliedFilters: {},
  };
}

describe('HomePageContent', () => {
  beforeEach(() => {
    mockedGetListingsMeta.mockResolvedValue({
      dataUpdatedAt: '2026-04-20T18:00:00.000Z',
      sources: ['internal'],
      listingCount: 13,
    });
  });

  afterEach(() => {
    mockedSearchListings.mockReset();
    mockedGetListingsMeta.mockReset();
  });

  describe('hero statistics', () => {
    it('renders the real dataset count rather than a hardcoded figure', async () => {
      mockedSearchListings.mockResolvedValue(envelope([aListingCardRow()]));

      render(<HomePageContent />);

      await waitFor(() => expect(screen.getByText('13')).toBeInTheDocument());
      expect(screen.getByText('Homes listed')).toBeInTheDocument();
      // The old tile asserted "12k+ Active listings", which was a fabricated inventory figure.
      expect(screen.queryByText(/12k\+/)).not.toBeInTheDocument();
    });

    it('makes no MLS claim, because every row is internal and there is no Bright licence yet', async () => {
      mockedSearchListings.mockResolvedValue(envelope([aListingCardRow()]));

      render(<HomePageContent />);

      await waitFor(() => expect(screen.getByText('States licensed')).toBeInTheDocument());
      expect(screen.queryByText('MLS')).not.toBeInTheDocument();
      expect(screen.queryByText(/Daily updates/)).not.toBeInTheDocument();
    });

    it('omits the count tile entirely when the dataset count is unavailable', async () => {
      mockedGetListingsMeta.mockRejectedValue(new Error('unavailable'));
      mockedSearchListings.mockResolvedValue(envelope([aListingCardRow()]));

      render(<HomePageContent />);

      await waitFor(() => expect(screen.getByText('States licensed')).toBeInTheDocument());
      expect(screen.queryByText('Homes listed')).not.toBeInTheDocument();
    });
  });

  describe('neighborhood tiles', () => {
    it('asserts no per-neighborhood inventory count', async () => {
      mockedSearchListings.mockResolvedValue(envelope([aListingCardRow()]));

      render(<HomePageContent />);

      await waitFor(() => expect(screen.getByText('Explore neighborhoods')).toBeInTheDocument());
      // These were hardcoded ("24 homes", "18 homes", …) — fabricated, and verifiably wrong beside
      // carousels that now come from the real API.
      expect(screen.queryByText(/\d+ homes/)).not.toBeInTheDocument();
    });
  });

  it('fires every carousel query in parallel rather than one after another', () => {
    mockedSearchListings.mockReturnValue(new Promise(() => {})); // never resolves
    render(<HomePageContent />);

    // All carousel queries are issued on the same tick — none is gated behind another's result.
    expect(mockedSearchListings.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('renders one carousel once its own fetch resolves, even while others are still pending', async () => {
    mockedSearchListings.mockImplementation((query: { sort?: string }) => {
      if (query.sort === 'recommended') {
        return Promise.resolve(
          envelope([aListingCardRow({ id: 'featured-1', title: 'Featured Row' })]),
        );
      }
      return new Promise(() => {}); // the rest never resolve in this test
    });

    render(<HomePageContent />);

    await waitFor(() => expect(screen.getByText('Featured homes for sale')).toBeInTheDocument());
  });

  it('degrades gracefully when one carousel fails — the rest of the page still renders', async () => {
    mockedSearchListings.mockImplementation((query: { sort?: string }) => {
      if (query.sort === 'recommended') {
        return Promise.reject(new Error('featured carousel is down'));
      }
      if (query.sort === 'newest') {
        return Promise.resolve(
          envelope([aListingCardRow({ id: 'recent-1', title: 'Recent Row' })]),
        );
      }
      return Promise.resolve(envelope([]));
    });

    render(<HomePageContent />);

    await waitFor(() => expect(screen.getByText('Just listed homes for sale')).toBeInTheDocument());
    // The failed carousel's own heading never appears — it renders nothing, not an error UI.
    expect(screen.queryByText('Featured homes for sale')).not.toBeInTheDocument();
  });
});
