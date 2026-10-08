import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SavedHome } from '@cribstop/property-contracts';
import { aListingCardRow, aListingDetail } from '@/test/fixtures';
import { getListing, ListingsApiError, toListingDetailView } from '@/lib/api/listings';
import { listAllSavedHomes, SavedHomesApiError } from '@/lib/api/saved-homes';
import FavoritesPage from './page';

jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return {
    ...actual,
    getListing: jest.fn(),
  };
});

jest.mock('@/lib/api/saved-homes', () => {
  const actual = jest.requireActual('@/lib/api/saved-homes');
  return { ...actual, listAllSavedHomes: jest.fn() };
});

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockRemoveSaved = jest.fn();
const mockAdoptSaved = jest.fn();
let mockSavedPropertyIds = new Set<string>();
let mockSavedHomes: { propertyId: string; listingId: string | null }[] = [];
let mockUser: { id: string } | null = { id: 'user-1' };

jest.mock('@/lib/context', () => ({
  useApp: () => ({
    user: mockUser,
    savedHomes: mockSavedHomes,
    savedPropertyIds: mockSavedPropertyIds,
    removeSaved: mockRemoveSaved,
    adoptSaved: mockAdoptSaved,
    toggleSave: jest.fn(),
    isSaved: (id: string) => mockSavedPropertyIds.has(id),
  }),
}));

// #433: ListingCard's footer share/copy-link controls call useToast(), which needs a
// react-redux Provider absent from these tests.
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockedGetListing = getListing as jest.Mock;
const mockedListAll = listAllSavedHomes as jest.Mock;

const LISTED_HOME = 'aaaaaaaa-0000-4000-8000-000000000001';
const OFF_MARKET_HOME = 'bbbbbbbb-0000-4000-8000-000000000002';

function savedHome(overrides: Partial<SavedHome> = {}): SavedHome {
  return {
    propertyId: LISTED_HOME,
    savedAt: '2026-10-01T00:00:00.000Z',
    savedFromListingId: null,
    marketStatus: 'Off market',
    canonicalPath: null,
    property: {
      address: '12 Quiet Ct',
      unitNumber: null,
      city: 'Frederick',
      state: 'MD',
      zip: '21701',
      neighborhood: null,
      propertyType: 'Single Family',
      beds: 3,
      baths: 2,
      sqft: 1800,
      lotSqft: null,
      yearBuilt: 1990,
      isSample: false,
    },
    listing: null,
    ...overrides,
  };
}

function setSaved(...ids: string[]) {
  mockSavedPropertyIds = new Set(ids);
  mockSavedHomes = ids.map((propertyId) => ({ propertyId, listingId: null }));
}

describe('FavoritesPage, signed in', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1' };
    setSaved(LISTED_HOME, OFF_MARKET_HOME);
    mockRemoveSaved.mockReset();
    mockAdoptSaved.mockReset();
  });

  afterEach(() => {
    mockedListAll.mockReset();
  });

  it('renders an off-market home as a labelled card with no price, next to a listed home', async () => {
    mockedListAll.mockResolvedValue([
      savedHome({
        marketStatus: 'Active',
        canonicalPath: '/property/x',
        listing: aListingCardRow({
          propertyId: LISTED_HOME,
          address: '9 Still Listed Ln',
        }),
      }),
      savedHome({ propertyId: OFF_MARKET_HOME }),
    ]);

    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByText(/^9 Still Listed Ln,/)).toBeInTheDocument());
    expect(screen.getByText('Not currently listed')).toBeInTheDocument();
    expect(screen.getByText(/^12 Quiet Ct, Frederick, MD 21701/)).toBeInTheDocument();
    const offMarket = document.querySelector('[data-off-market]') as HTMLElement;
    expect(offMarket.textContent).not.toMatch(/\$/);
    expect(screen.getByText('2 saved homes · synced to your account')).toBeInTheDocument();
  });

  it('shows no street and no ZIP for an off-market home whose address is masked', async () => {
    mockedListAll.mockResolvedValue([
      savedHome({
        propertyId: OFF_MARKET_HOME,
        property: { ...savedHome().property, address: null },
      }),
    ]);
    setSaved(OFF_MARKET_HOME);

    render(<FavoritesPage />);

    expect(await screen.findByText('Frederick, MD')).toBeInTheDocument();
    expect(screen.queryByText(/21701/)).not.toBeInTheDocument();
  });

  it('unsaves from the off-market card, and the card leaves the list', async () => {
    mockedListAll.mockResolvedValue([savedHome({ propertyId: OFF_MARKET_HOME })]);
    setSaved(OFF_MARKET_HOME);
    const { rerender } = render(<FavoritesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Unsave' }));
    expect(mockRemoveSaved).toHaveBeenCalledWith(OFF_MARKET_HOME);

    // The store drops the home, so the page drops the card.
    setSaved();
    rerender(<FavoritesPage />);
    expect(screen.queryByText('Not currently listed')).not.toBeInTheDocument();
  });

  it('adopts the server list into the store', async () => {
    mockedListAll.mockResolvedValue([savedHome({ propertyId: OFF_MARKET_HOME })]);
    render(<FavoritesPage />);

    await screen.findByText('Not currently listed');
    expect(mockAdoptSaved).toHaveBeenCalledWith([{ propertyId: OFF_MARKET_HOME, listingId: null }]);
  });

  it('renders a retryable error state when the list fails', async () => {
    mockedListAll.mockRejectedValue(new SavedHomesApiError('Saved homes are down.', 503));
    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the empty state when the account has no saved homes', async () => {
    mockedListAll.mockResolvedValue([]);
    setSaved();
    render(<FavoritesPage />);

    expect(await screen.findByText('No saved homes yet')).toBeInTheDocument();
  });
});

describe('FavoritesPage, signed out', () => {
  beforeEach(() => {
    mockUser = null;
    mockSavedPropertyIds = new Set([LISTED_HOME, OFF_MARKET_HOME]);
    mockSavedHomes = [
      { propertyId: LISTED_HOME, listingId: 'aaaaaaaa-1111-4000-8000-000000000001' },
      { propertyId: OFF_MARKET_HOME, listingId: 'bbbbbbbb-1111-4000-8000-000000000002' },
    ];
  });

  afterEach(() => {
    mockedGetListing.mockReset();
  });

  it('falls back to the local list and keeps browsing open, with a sign-in prompt', async () => {
    const survivor = toListingDetailView(
      aListingDetail({ listing: { address: '9 Still Listed Ln' } }),
    );
    mockedGetListing.mockImplementation((id: string) =>
      id.startsWith('aaaaaaaa')
        ? Promise.resolve({ ...survivor, subjectId: LISTED_HOME })
        : Promise.reject(
            new ListingsApiError('This listing is no longer available.', 'not_found', 404),
          ),
    );

    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByText(/^9 Still Listed Ln,/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(mockedListAll).not.toHaveBeenCalled();
  });

  it('renders a retryable error state when every local listing fails for a real reason', async () => {
    mockedGetListing.mockRejectedValue(
      new ListingsApiError('We could not load listings just now.', 'internal_error', 503),
    );
    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('treats every local listing 404ing as a normal empty state', async () => {
    mockedGetListing.mockRejectedValue(
      new ListingsApiError('This listing is no longer available.', 'not_found', 404),
    );
    render(<FavoritesPage />);

    await waitFor(() => expect(screen.getByText('No saved homes yet')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing is saved', () => {
    mockSavedPropertyIds = new Set();
    mockSavedHomes = [];
    render(<FavoritesPage />);

    expect(screen.getByText('No saved homes yet')).toBeInTheDocument();
  });
});
