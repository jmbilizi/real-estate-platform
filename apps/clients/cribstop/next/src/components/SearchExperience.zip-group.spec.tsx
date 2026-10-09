import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getNeighborhoodGroups, getZipGroups, searchListings } from '@/lib/api/listings';
import SearchExperience from './SearchExperience';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoodGroups: jest.fn(),
  getZipGroups: jest.fn(),
  ListingsApiError: class extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

jest.mock('@/components/ListingsMap', () => ({
  __esModule: true,
  default: () => <div data-testid="map" />,
}));
jest.mock('@/components/CompactSearchBar', () => ({
  __esModule: true,
  default: () => <div data-testid="search-bar" />,
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockAppContext = {
  savedHomes: [],
  savedPropertyIds: new Set<string>(),
  setSearchLocation: jest.fn(),
  setSearchSuggestion: jest.fn(),
  setSearchListingType: jest.fn(),
  toggleSave: jest.fn(),
  isSaved: () => false,
};
jest.mock('@/lib/context', () => ({ useApp: () => mockAppContext }));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

const mockedSearch = searchListings as jest.Mock;
const mockedZips = getZipGroups as jest.Mock;
const mockedNeighborhoods = getNeighborhoodGroups as jest.Mock;

const zipsResponse = (keys: string[]) => ({
  groups: keys.map((key, i) => ({ key, count: 10 - i })),
  total: keys.length,
  listingTotal: keys.reduce((sum, _key, i) => sum + 10 - i, 0),
});

const openGroupOptions = () => {
  fireEvent.click(screen.getByTestId('group-by-control'));
  return screen.queryAllByRole('option').map((option) => option.textContent);
};
const currentParams = () => new URLSearchParams(window.location.search);
const lastZipQuery = () => mockedZips.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  mockedSearch.mockResolvedValue({
    results: [],
    total: 0,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    appliedFilters: {},
  });
  mockedNeighborhoods.mockResolvedValue({ results: [], total: 0 });
  mockedZips.mockResolvedValue(zipsResponse(['20814', '20815', '20816']));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Bethesda');
});

afterEach(() => {
  mockPush.mockReset();
  mockedSearch.mockReset();
  mockedZips.mockReset();
  mockedNeighborhoods.mockReset();
});

describe('Group by ZIP code (#722)', () => {
  it('reads the ZIP count with a one-group request and offers the option for several ZIPs', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    await waitFor(() => expect(mockedZips).toHaveBeenCalled());

    expect(lastZipQuery()).toMatchObject({ limit: 1, minCount: 1, offset: 0 });
    await waitFor(() => expect(openGroupOptions()).toContain('ZIP code'));
  });

  it('hides the option when the search spans one ZIP code', async () => {
    mockedZips.mockResolvedValue(zipsResponse(['20814']));
    render(<SearchExperience initialQuery="q=Bethesda" />);
    await waitFor(() => expect(mockedZips).toHaveBeenCalled());
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(openGroupOptions()).toEqual(['None', 'Neighborhood', 'Broker']);
  });

  it('hides the option with no request when the search has a zip filter', async () => {
    render(<SearchExperience initialQuery="zip=20814" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(mockedZips).not.toHaveBeenCalled();
    expect(openGroupOptions()).toEqual(['None', 'Neighborhood', 'Broker']);
  });

  it('hides the option when the ZIP request fails', async () => {
    mockedZips.mockRejectedValue(new Error('not found'));
    render(<SearchExperience initialQuery="q=Bethesda" />);
    await waitFor(() => expect(mockedZips).toHaveBeenCalled());

    expect(openGroupOptions()).toEqual(['None', 'Neighborhood', 'Broker']);
  });

  it('reads groupBy=zip on a single-ZIP search as no grouping', async () => {
    mockedZips.mockResolvedValue(zipsResponse(['20814']));
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=zip" />);

    await waitFor(() => expect(screen.getByText('Homes')).toBeTruthy());
    expect(screen.queryByTestId('zip-group-grid')).toBeNull();
  });

  it('reads groupBy=zip on a zip-filtered search as no grouping, with no ZIP request', async () => {
    render(<SearchExperience initialQuery="zip=20814&groupBy=zip" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(mockedZips).not.toHaveBeenCalled();
    expect(screen.queryByTestId('zip-group-grid')).toBeNull();
  });

  it('shows ZIP cards, writes groupBy to the URL and never groups by default', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    await waitFor(() => expect(mockedZips).toHaveBeenCalled());
    expect(screen.queryByTestId('zip-group-grid')).toBeNull();
    expect(currentParams().get('groupBy')).toBeNull();

    await waitFor(() => expect(openGroupOptions()).toContain('ZIP code'));
    fireEvent.click(screen.getByRole('option', { name: 'ZIP code' }));

    expect(await screen.findByTestId('zip-group-grid')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ZIP code 20814, 10 homes' })).toBeTruthy();
    expect(screen.getByText('ZIP codes')).toBeTruthy();
    expect(currentParams().get('groupBy')).toBe('zip');
    expect(lastZipQuery()).toMatchObject({ limit: 24, offset: 0, order: 'count', minCount: 1 });
  });

  it('shows the neighborhood photo stack on a card, and the same placeholder with no photo (#722)', async () => {
    mockedZips.mockImplementation((query: { limit?: number }) =>
      Promise.resolve({
        groups: [
          {
            key: '20814',
            count: 4,
            previewPhotos:
              query.limit === 1
                ? undefined
                : [{ url: 'https://cdn.example/a.jpg', listingId: 'a' }],
          },
          { key: '20815', count: 3 },
        ],
        total: 2,
        listingTotal: 7,
      }),
    );
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=zip" />);
    const grid = await screen.findByTestId('zip-group-grid');

    expect(grid.querySelectorAll('img')).toHaveLength(1);
    expect(grid.querySelectorAll('[data-testid="neighborhood-photo-placeholder"]')).toHaveLength(1);
  });

  it('opens a ZIP with a removable chip, and removing it returns to the ZIP groups', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=zip" />);
    const card = await screen.findByRole('link', { name: 'ZIP code 20815, 9 homes' });

    fireEvent.click(card);
    await waitFor(() => expect(currentParams().get('zip')).toBe('20815'));
    expect(currentParams().get('groupBy')).toBeNull();
    expect(currentParams().get('groupDrill')).toBe('zip');
    const chip = await screen.findByTestId('clear-group-drill');
    expect(chip.textContent).toContain('ZIP 20815');

    fireEvent.click(chip);
    await waitFor(() => expect(currentParams().get('groupBy')).toBe('zip'));
    expect(currentParams().get('zip')).toBeNull();
    expect(currentParams().get('groupDrill')).toBeNull();
    expect(await screen.findByTestId('zip-group-grid')).toBeTruthy();
  });

  it('shows the loading skeleton, then the empty state', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockedZips.mockImplementation((query: { limit?: number }) =>
      query.limit === 1
        ? Promise.resolve(zipsResponse(['20814', '20815']))
        : new Promise((r) => (resolve = r)),
    );
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=zip" />);
    expect(await screen.findByTestId('zip-group-skeleton')).toBeTruthy();

    resolve({ groups: [], total: 0, listingTotal: 0 });
    expect(await screen.findByTestId('zip-group-empty')).toBeTruthy();
  });
});
