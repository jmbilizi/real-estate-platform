import { act, render, screen, waitFor } from '@testing-library/react';
import { aListingDetail } from '@/test/fixtures';
import { getListing, ListingsApiError, toListingDetailView } from '@/lib/api/listings';
import { clearListingCache } from '@/lib/api/listings-cache';
import ListingDetailModal from './ListingDetailModal';

jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return {
    ...actual,
    getListing: jest.fn(),
  };
});

// The fetch lifecycle is what this suite tests, not the detail page's own rendering — that's
// ListingDetailContent's own spec. A stub keeps these tests from depending on the redux store,
// SingleListingMap/leaflet, and the similar-homes fetch that component owns.
jest.mock('@/components/ListingDetailContent', () => ({
  __esModule: true,
  default: ({ listing }: { listing: { id: string } }) => (
    <div data-testid="listing-detail-content">{listing.id}</div>
  ),
}));

const mockedGetListing = getListing as jest.Mock;

beforeEach(() => {
  mockedGetListing.mockReset();
  // The detail cache is a module-level map that outlives a render, which is the whole point of it
  // — but it also outlives a *test*. Without this, the first case to resolve a listing serves every
  // later case from cache and the mock is never called again.
  clearListingCache();
});

describe('ListingDetailModal', () => {
  it('shows a skeleton while loading', () => {
    mockedGetListing.mockReturnValue(new Promise(() => {})); // never resolves in this test
    render(<ListingDetailModal id="11111111-1111-4111-8111-111111111111" />);

    expect(screen.getByRole('status', { name: /loading listing/i })).toBeInTheDocument();
  });

  it('renders the listing once the fetch resolves', async () => {
    const view = toListingDetailView(aListingDetail());
    mockedGetListing.mockResolvedValue(view);

    render(<ListingDetailModal id={view.id} />);

    expect(await screen.findByTestId('listing-detail-content')).toHaveTextContent(view.id);
  });

  it('renders a calm, distinct "no longer available" state on a 404 — not the generic error banner', async () => {
    mockedGetListing.mockRejectedValue(
      new ListingsApiError('This listing is no longer available.', 'not_found', 404),
    );

    render(<ListingDetailModal id="11111111-1111-4111-8111-111111111111" />);

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('renders the error state with a retry for a non-404 failure', async () => {
    mockedGetListing.mockRejectedValue(
      new ListingsApiError(
        'We could not load this listing just now. Please try again.',
        'internal_error',
        500,
      ),
    );

    render(<ListingDetailModal id="11111111-1111-4111-8111-111111111111" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('aborts the in-flight fetch on unmount without setting state', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedGetListing.mockImplementation((_id: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const { unmount } = render(<ListingDetailModal id="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect(capturedSignal).toBeDefined());

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('refetches on retry', async () => {
    mockedGetListing.mockRejectedValueOnce(
      new ListingsApiError(
        'We could not load this listing just now. Please try again.',
        'internal_error',
        500,
      ),
    );
    const view = toListingDetailView(aListingDetail());
    mockedGetListing.mockResolvedValueOnce(view);

    render(<ListingDetailModal id={view.id} />);
    const retryButton = await screen.findByRole('button', { name: /try again/i });

    await act(async () => {
      retryButton.click();
    });

    expect(await screen.findByTestId('listing-detail-content')).toBeInTheDocument();
    expect(mockedGetListing).toHaveBeenCalledTimes(2);
  });

  /*
   * The cheap-list / rich-detail split is only a good trade if opening the same listing twice costs
   * one fetch. These two cover the paths that make it so.
   */

  it('serves a listing opened earlier in the session from cache, without refetching', async () => {
    const view = toListingDetailView(aListingDetail());
    mockedGetListing.mockResolvedValue(view);

    const first = render(<ListingDetailModal id={view.id} />);
    expect(await screen.findByTestId('listing-detail-content')).toBeInTheDocument();
    first.unmount();

    render(<ListingDetailModal id={view.id} />);

    // Present on the first render rather than found asynchronously — a cached listing never passes
    // through the skeleton.
    expect(screen.getByTestId('listing-detail-content')).toHaveTextContent(view.id);
    expect(mockedGetListing).toHaveBeenCalledTimes(1);
  });

  it('renders a server-resolved listing without fetching at all', () => {
    const view = toListingDetailView(aListingDetail());

    render(<ListingDetailModal id={view.id} initialState={{ status: 'ready', listing: view }} />);

    expect(screen.getByTestId('listing-detail-content')).toHaveTextContent(view.id);
    expect(mockedGetListing).not.toHaveBeenCalled();
  });

  it('renders a server-resolved 404 as the "no longer available" state, without fetching', () => {
    render(
      <ListingDetailModal
        id="11111111-1111-4111-8111-111111111111"
        initialState={{ status: 'not-found' }}
      />,
    );

    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(mockedGetListing).not.toHaveBeenCalled();
  });

  it('retries against the API even when the server supplied the failure', async () => {
    const view = toListingDetailView(aListingDetail());
    mockedGetListing.mockResolvedValue(view);

    render(
      <ListingDetailModal
        id={view.id}
        initialState={{ status: 'error', message: 'We could not load this listing just now.' }}
      />,
    );

    const retryButton = await screen.findByRole('button', { name: /try again/i });
    await act(async () => {
      retryButton.click();
    });

    expect(await screen.findByTestId('listing-detail-content')).toBeInTheDocument();
    expect(mockedGetListing).toHaveBeenCalledTimes(1);
  });
});
