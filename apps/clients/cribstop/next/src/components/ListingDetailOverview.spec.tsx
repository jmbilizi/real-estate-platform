import { render, screen, waitFor, within } from '@testing-library/react';
import { aListingCardRow, aListingDetail } from '@/test/fixtures';
import { searchListings, toListingDetailView } from '@/lib/api/listings';
import ListingDetailContent from './ListingDetailContent';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/api/listings', () => ({
  ...jest.requireActual('@/lib/api/listings'),
  searchListings: jest.fn(),
}));
jest.mock('@/components/SingleListingMap', () => ({
  __esModule: true,
  default: () => <div data-testid="single-listing-map" />,
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

async function renderAndSettle(ui: React.ReactElement) {
  const result = render(ui);
  await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());
  return result;
}

const noFacts = aListingDetail().listing.facts;

describe('ListingDetailContent — overview block and facts (#568)', () => {
  it('shows the address and the stats once, inside the overview block', async () => {
    const view = toListingDetailView(aListingDetail());
    const { container } = await renderAndSettle(<ListingDetailContent listing={view} />);

    const overview = container.querySelector('#overview') as HTMLElement;
    expect(within(overview).getByRole('heading', { level: 1 })).toHaveTextContent(
      '100 Test St, Bethesda, MD 20814',
    );
    expect(within(overview).getByText('Beds')).toBeInTheDocument();
    expect(screen.getAllByText(/100 Test St/)).toHaveLength(1);
    expect(screen.getAllByText('Beds')).toHaveLength(1);
  });

  it('shows the price once: the mobile bar carries none', async () => {
    const view = toListingDetailView(aListingDetail());
    const { container } = await renderAndSettle(<ListingDetailContent listing={view} />);

    const price = (container.querySelector('#overview') as HTMLElement).querySelector(
      'p.text-xl',
    ) as HTMLElement;
    expect(screen.getAllByText(price.textContent as string)).toHaveLength(1);
  });

  it('gives each section a stable id', () => {
    const view = toListingDetailView(
      aListingDetail({ listing: { facts: { ...noFacts, heating: ['Gas'] } } }),
    );
    const { container } = render(
      <ListingDetailContent
        listing={view}
        nearby={aNearbyRows()}
        propertyPanel={<div>History</div>}
      />,
    );

    for (const id of ['overview', 'facts', 'map', 'history', 'nearby']) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('renders no facts section when the listing has no facts', async () => {
    const view = toListingDetailView(aListingDetail());
    const { container } = await renderAndSettle(<ListingDetailContent listing={view} />);

    expect(container.querySelector('#facts')).toBeNull();
  });

  it('renders only the groups that have data, with tax, and omits a zero HOA fee', async () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          taxAnnualAmount: 4210,
          taxYear: 2025,
          hoaFee: 0,
          facts: { ...noFacts, parking: ['Garage', 'Driveway'] },
        },
      }),
    );
    await renderAndSettle(<ListingDetailContent listing={view} />);

    const facts = screen.getByTestId('listing-facts');
    expect(within(facts).getByText('Garage, Driveway')).toBeInTheDocument();
    expect(within(facts).getByText('$4,210 (2025)')).toBeInTheDocument();
    expect(within(facts).queryByText('HOA fee')).toBeNull();
    expect(within(facts).queryByText('Interior')).toBeNull();
    expect(facts.textContent).not.toMatch(/\$0\b|—/);
  });
});

function aNearbyRows() {
  return [aListingCardRow()];
}
