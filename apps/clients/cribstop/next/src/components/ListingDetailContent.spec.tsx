import { render, screen, waitFor } from '@testing-library/react';
import { aListingDetail } from '@/test/fixtures';
import { searchListings, toListingDetailView } from '@/lib/api/listings';
import ListingDetailContent from './ListingDetailContent';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));

jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return {
    ...actual,
    searchListings: jest.fn(),
  };
});

// The map is exercised on its own in SingleListingMap.spec.tsx (including the "no pin for a
// suppressed address" guarantee). Stubbing it here keeps these tests focused on content and
// avoids mounting react-leaflet/next-dynamic in every case.
jest.mock('@/components/SingleListingMap', () => ({
  __esModule: true,
  default: (props: { latitude: number | null; longitude: number | null }) => (
    <div
      data-testid="single-listing-map"
      data-lat={props.latitude ?? ''}
      data-lng={props.longitude ?? ''}
    />
  ),
}));

const mockedSearchListings = searchListings as jest.Mock;

beforeEach(() => {
  mockedSearchListings.mockReset();
  mockedSearchListings.mockResolvedValue({
    results: [],
    total: 0,
    page: 1,
    pageSize: 8,
    pageCount: 0,
    appliedFilters: {},
  });
});

/** Renders and waits for the "Similar Homes" fetch to settle, so no test leaves a dangling
 *  unresolved promise that would warn about a state update outside `act`. */
async function renderAndSettle(...args: Parameters<typeof render>) {
  const result = render(...args);
  await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());
  return result;
}

describe('ListingDetailContent — provenance (#24 acceptance criterion)', () => {
  it('renders no Bright provenance string for an internal listing', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'internal' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText(/Bright/i)).toBeNull();
  });

  it('renders the Bright provenance line for a brightMLS listing', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'brightMLS' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText(/Bright MLS/i)).toBeInTheDocument();
  });

  it('renders neither provenance line for an "other" source listing', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { source: 'other' } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText(/Bright/i)).toBeNull();
    expect(screen.queryByText(/provided by/i)).toBeNull();
  });
});

describe('ListingDetailContent — price', () => {
  it('renders the withheld copy and never $0 when price is null', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { price: null } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getAllByText(/Price withheld/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('shows the close price with its close date for a sold listing', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          status: 'Sold',
          closePrice: 610000,
          closeDate: '2026-03-15',
        },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getAllByText(/Sold for \$610,000 on Mar 15, 2026/).length).toBeGreaterThan(0);
  });
});

describe('ListingDetailContent — parcel', () => {
  it('renders no dwelling stat block and does not throw', async () => {
    const view = toListingDetailView(
      aListingDetail({
        property: { propertyType: 'Land' },
        listing: { propertyType: 'Land', beds: null, baths: null, sqft: null, lotSqft: 104544 },
      }),
    );

    await expect(renderAndSettle(<ListingDetailContent listing={view} />)).resolves.not.toThrow();

    expect(screen.queryByText('Beds')).toBeNull();
    expect(screen.queryByText('Baths')).toBeNull();
    expect(screen.queryByText('Sqft')).toBeNull();
  });
});

describe('ListingDetailContent — suppressed address', () => {
  it('renders no address and passes no coordinates to the map', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: { address: null, latitude: null, longitude: null },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.queryByText('100 Test St')).toBeNull();
    const map = screen.getByTestId('single-listing-map');
    expect(map.getAttribute('data-lat')).toBe('');
    expect(map.getAttribute('data-lng')).toBe('');
  });
});

describe('ListingDetailContent — sample labelling', () => {
  it('renders the sample label for a sample row', async () => {
    const view = toListingDetailView(aListingDetail({ listing: { isSample: true } }));
    await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });
});
