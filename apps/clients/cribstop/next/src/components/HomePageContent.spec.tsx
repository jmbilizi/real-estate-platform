import { render, screen, waitFor } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { searchListings } from '@/lib/api/listings';
import HomePageContent from './HomePageContent';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
}));

jest.mock('@/lib/context', () => ({
  useApp: () => ({ listingType: 'sale', toggleSave: jest.fn(), isSaved: () => false }),
}));

const mockedSearchListings = searchListings as jest.Mock;

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
  afterEach(() => {
    mockedSearchListings.mockReset();
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
