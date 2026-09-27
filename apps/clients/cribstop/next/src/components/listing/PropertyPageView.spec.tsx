import { render, screen, waitFor } from '@testing-library/react';
import type { MarketStatus } from '@cribstop/property-contracts';
import { aPropertyPage } from '@/test/fixtures';
import { searchListings } from '@/lib/api/listings';
import PropertyPageView from './PropertyPageView';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));

jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return { ...actual, searchListings: jest.fn() };
});

// Displayed only through `ListingDetailContent`; stubbed for the same reason
// `ListingDetailContent.spec.tsx` stubs it — avoid mounting react-leaflet/next-dynamic here.
jest.mock('@/components/SingleListingMap', () => ({
  __esModule: true,
  default: () => <div data-testid="single-listing-map" />,
}));

const mockedSearchListings = searchListings as jest.Mock;

const EMPTY_ENVELOPE = {
  results: [],
  total: 0,
  page: 1,
  pageSize: 8,
  pageCount: 0,
  appliedFilters: {},
};

beforeEach(() => {
  mockedSearchListings.mockReset();
  mockedSearchListings.mockResolvedValue(EMPTY_ENVELOPE);
});

const DISPLAYABLE_STATUSES: MarketStatus[] = [
  'Active',
  'Coming Soon',
  'Under Contract',
  'Pending',
  'Sold',
];

describe('PropertyPageView — market-status badge (#349)', () => {
  it.each(DISPLAYABLE_STATUSES)('renders the exact badge text for %s', async (marketStatus) => {
    render(<PropertyPageView page={aPropertyPage({ marketStatus })} />);

    // The detail branch also fires the "similar homes" fetch; settle it so no test leaves a
    // dangling update outside `act`.
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

    expect(screen.getByTestId('market-status-badge')).toHaveTextContent(marketStatus);
  });
});

describe('PropertyPageView — Off market (#349)', () => {
  it('renders the address, the Off market badge, facts and the sample badge — nothing detail-only', () => {
    const page = aPropertyPage({
      marketStatus: 'Off market',
      propertyRecord: {
        address: '118 Baggett Place',
        unitNumber: null,
        beds: 3,
        baths: 2,
        sqft: 1800,
        lotSqft: 6000,
        yearBuilt: 1994,
        isSample: true,
      },
    });

    render(<PropertyPageView page={page} />);

    expect(screen.getByTestId('market-status-badge')).toHaveTextContent('Off market');
    expect(screen.getByText('118 Baggett Place')).toBeInTheDocument();
    expect(screen.getByText(/Alexandria, VA 22301/)).toBeInTheDocument();
    expect(screen.getByText('Beds')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    expect(screen.getByText(/not listed for sale or rent right now/i)).toBeInTheDocument();

    // Never a photo, price, agent, remarks or upsell on this branch.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/\$[\d,]/)).toBeNull();
    expect(screen.queryByText(/schedule a tour/i)).toBeNull();
    expect(screen.queryByText(/message agent/i)).toBeNull();
    expect(screen.queryByText(/similar homes/i)).toBeNull();

    // The similar-homes fetch never fires on this branch — no `ListingDetailContent` mounted.
    expect(mockedSearchListings).not.toHaveBeenCalled();
  });

  it('shows a neutral "Address withheld" line, and still the city/state/ZIP, when the address is null', () => {
    const page = aPropertyPage({
      marketStatus: 'Off market',
      propertyRecord: { address: null, unitNumber: null },
    });

    render(<PropertyPageView page={page} />);

    expect(screen.getByText('Address withheld')).toBeInTheDocument();
    expect(screen.getByText(/Alexandria, VA 22301/)).toBeInTheDocument();
  });

  it('omits a null fact rather than rendering a dash or a zero', () => {
    const page = aPropertyPage({
      marketStatus: 'Off market',
      propertyRecord: { beds: null, baths: null, sqft: null, lotSqft: null, yearBuilt: null },
    });

    render(<PropertyPageView page={page} />);

    expect(screen.queryByText('Beds')).toBeNull();
    expect(screen.queryByText('Baths')).toBeNull();
    expect(screen.queryByText('Sqft')).toBeNull();
    expect(screen.queryByText('Year Built')).toBeNull();
    expect(screen.queryByText('Lot Size')).toBeNull();
    // `propertyType` is never null on the contract, so "Type" always renders.
    expect(screen.getByText('Type')).toBeInTheDocument();
  });

  it('does not render the sample badge when the record is not a sample', () => {
    const page = aPropertyPage({
      marketStatus: 'Off market',
      propertyRecord: { isSample: false },
    });

    render(<PropertyPageView page={page} />);

    expect(screen.queryByText('Sample data')).toBeNull();
  });
});
