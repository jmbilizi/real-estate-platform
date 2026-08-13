import { render, screen, waitFor } from '@testing-library/react';
import { aListingDetail } from '@/test/fixtures';
import { getListing, ListingsApiError, toListingDetailView } from '@/lib/api/listings';
import FavoritesPage from './page';

jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return {
    ...actual,
    getListing: jest.fn(),
  };
});

let mockSavedIds = new Set<string>();
let mockUser: { id: string } | null = { id: 'user-1' };

jest.mock('@/lib/context', () => ({
  useApp: () => ({
    user: mockUser,
    savedIds: mockSavedIds,
    toggleSave: jest.fn(),
    isSaved: () => false,
  }),
}));

const mockedGetListing = getListing as jest.Mock;

describe('FavoritesPage', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1' };
    mockSavedIds = new Set([
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002',
    ]);
  });

  afterEach(() => {
    mockedGetListing.mockReset();
  });

  it('renders the remaining saved homes when one saved id 404s (listing withdrawn)', async () => {
    const survivor = toListingDetailView(
      aListingDetail({ listing: { neighborhood: 'Still Listed Heights' } }),
    );

    mockedGetListing.mockImplementation((id: string) => {
      if (id === 'aaaaaaaa-0000-4000-8000-000000000001') {
        return Promise.reject(
          new ListingsApiError('This listing is no longer available.', 'not_found', 404),
        );
      }
      return Promise.resolve(survivor);
    });

    render(<FavoritesPage />);

    // `title` isn't rendered on the card at all — the location line is, so that's the marker.
    await waitFor(() =>
      expect(screen.getByText('Still Listed Heights, Bethesda')).toBeInTheDocument(),
    );
    // Withdrawn id is skipped quietly — no error surface for a partial failure.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a retryable error state when every saved id fails for a real reason', async () => {
    mockedGetListing.mockRejectedValue(
      new ListingsApiError(
        'We could not load listings just now. Please try again.',
        'internal_error',
        503,
      ),
    );

    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('keeps the existing empty state when there are no saved ids at all', () => {
    mockSavedIds = new Set();
    render(<FavoritesPage />);

    expect(screen.getByText('No saved homes yet')).toBeInTheDocument();
  });

  it('treats every saved id 404ing as a normal empty state, not a retryable error', async () => {
    mockedGetListing.mockRejectedValue(
      new ListingsApiError('This listing is no longer available.', 'not_found', 404),
    );

    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByText('No saved homes yet')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
