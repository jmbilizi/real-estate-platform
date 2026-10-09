import { render, screen, waitFor, within } from '@testing-library/react';
import { aListingDetail } from '@/test/fixtures';
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
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  jest.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
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

afterEach(() => jest.useRealTimers());

async function renderDetail(listing: NonNullable<Parameters<typeof aListingDetail>[0]>['listing']) {
  const view = toListingDetailView(aListingDetail({ listing }));
  render(<ListingDetailContent listing={view} />);
  await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());
}

const CUT = {
  price: 2_197_500,
  previousPrice: 2_297_500,
  priceChangedAt: '2026-10-02T00:00:00.000Z',
};

describe('ListingDetailContent price change (#717)', () => {
  it('writes the cut from the two stored prices', async () => {
    await renderDetail(CUT);

    expect(screen.getByTestId('price-change').textContent).toBe(
      'Reduced $100,000 (4.4%) from $2,297,500 on Oct 2',
    );
  });

  it('writes an increase the same way', async () => {
    await renderDetail({ ...CUT, price: 2_397_500 });

    expect(screen.getByTestId('price-change').textContent).toBe(
      'Increased $100,000 (4.4%) from $2,297,500 on Oct 2',
    );
  });

  it('shows no line for a change older than 90 days, or with no earlier price', async () => {
    await renderDetail({ ...CUT, priceChangedAt: '2026-07-01T00:00:00.000Z' });
    expect(screen.queryByTestId('price-change')).toBeNull();
  });

  it('shows no line when the service sends no price fields', async () => {
    await renderDetail({ price: 2_197_500 });
    expect(screen.queryByTestId('price-change')).toBeNull();
    expect(screen.queryByTestId('price-history')).toBeNull();
  });

  it('lists the price history with its footnote', async () => {
    await renderDetail({
      ...CUT,
      priceHistory: [
        { date: '2026-06-01T00:00:00.000Z', price: 2_297_500, change: null, mlsNumber: 'VAA1' },
        { date: '2026-10-02T00:00:00.000Z', price: 2_197_500, change: -100_000, mlsNumber: null },
      ],
    });

    const history = screen.getByTestId('price-history');
    const rows = within(history).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]?.textContent).toContain('Jun 1, 2026$2,297,500—VAA1');
    expect(rows[2]?.textContent).toContain('Oct 2, 2026$2,197,500');
    expect(rows[2]?.textContent).toContain('↓ $100,000');
    expect(within(history).getByText('Price history from MLS records we hold.')).toBeVisible();
  });
});

describe('toListingDetailView price fields (#717)', () => {
  it('reads absent price fields as none', () => {
    const detail = aListingDetail();
    const listing = { ...detail.listing } as Record<string, unknown>;
    delete listing.previousPrice;
    delete listing.priceChangedAt;
    delete listing.priceHistory;

    const view = toListingDetailView({ ...detail, listing } as unknown as typeof detail);

    expect([view.previousPrice, view.priceChangedAt, view.priceHistory]).toEqual([null, null, []]);
  });
});
