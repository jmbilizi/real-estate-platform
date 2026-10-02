import { render, screen, waitFor } from '@testing-library/react';
import { getNeighborhoodGroups, searchListings } from '@/lib/api/listings';
import SearchExperience from './SearchExperience';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoodGroups: jest.fn(),
  ListingsApiError: class extends Error {},
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
  savedIds: new Set<string>(),
  setSearchLocation: jest.fn(),
  setSearchSuggestion: jest.fn(),
  setSearchListingType: jest.fn(),
  toggleSave: jest.fn(),
  isSaved: () => false,
};
jest.mock('@/lib/context', () => ({ useApp: () => mockAppContext }));

const mockedSearch = searchListings as jest.Mock;
const mockedGroups = getNeighborhoodGroups as jest.Mock;

const kingstowne = {
  key: 'va|alexandria|kingstowne',
  name: 'Kingstowne',
  city: 'Alexandria',
  state: 'VA',
  slug: 'kingstowne',
  total: 41,
  sale: 28,
  rent: 13,
  centroid: null,
  bounds: null,
};

const hrefOf = async (name: RegExp) =>
  new URL((await screen.findByRole('link', { name })).getAttribute('href') ?? '', 'http://x');

beforeEach(() => {
  mockedSearch.mockResolvedValue({
    results: [],
    total: 0,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    appliedFilters: {},
  });
  mockedGroups.mockResolvedValue({ results: [kingstowne], total: 1 });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
});

afterEach(() => {
  mockedSearch.mockReset();
  mockedGroups.mockReset();
});

const CASES = [
  {
    scope: 'city path',
    url: '/alexandria-va/homes-for-sale',
    place: { filters: { city: 'Alexandria', state: 'VA' }, label: 'Alexandria, VA' },
    prefix: '/alexandria-va',
  },
  {
    scope: 'county path',
    url: '/fairfax-county-va/homes-for-sale',
    place: { filters: { county: 'Fairfax County', state: 'VA' }, label: 'Fairfax County, VA' },
    prefix: '/fairfax-county-va',
  },
  {
    scope: 'state (map-area) path',
    url: '/homes-for-sale',
    place: { filters: { state: 'VA' }, label: '' },
    prefix: '',
    extra: 'state=VA&',
  },
] as const;

describe.each(CASES)('count links on a $scope (#528)', (c) => {
  const extra = 'extra' in c ? c.extra : '';

  describe.each([
    ['all', 'type=all&'],
    ['sale', ''],
  ])('grouped view of type %s', (viewType, typeQuery) => {
    const query = `${extra}${typeQuery}groupBy=neighborhood`;
    const place = {
      ...c.place,
      filters: { ...c.place.filters, ...(viewType === 'sale' ? { listingType: 'sale' } : {}) },
      query: viewType === 'all' ? 'type=all' : '',
    } as never;

    beforeEach(() => {
      window.history.replaceState(null, '', `${c.url}?${query}`);
    });

    it('opens exactly the rent homes for the rent count, with the card number', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      const link = await screen.findByRole('link', { name: /for rent in Kingstowne/ });
      expect(link.textContent).toContain('13');
      const href = await hrefOf(/for rent in Kingstowne/);
      expect(href.pathname).toBe(`${c.prefix}/homes-for-rent`);
      expect(href.searchParams.has('type')).toBe(false);
      expect(href.searchParams.get('neighborhood')).toBe('Kingstowne');
      expect(href.searchParams.has('groupBy')).toBe(false);
      // The way back returns to the grouped view's own type.
      expect(href.searchParams.get('groupFrom')).toMatch(new RegExp(`\\|${viewType}$`));
    });

    it('opens exactly the sale homes for the sale count', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      const link = await screen.findByRole('link', { name: /for sale in Kingstowne/ });
      expect(link.textContent).toContain('28');
      const href = await hrefOf(/for sale in Kingstowne/);
      if (viewType === 'sale') {
        // Same type as the view: the click commits in place and the path stays.
        expect(href.pathname).toBe(c.url.replace(/^\/?/, '/'));
      } else {
        expect(href.pathname).toBe(`${c.prefix}/homes-for-sale`);
      }
      expect(href.searchParams.has('type')).toBe(false);
    });

    it('keeps the grouped view type on the name link', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      const href = await hrefOf(/^Kingstowne$/);
      expect(href.pathname).toBe(c.url.replace(/^\/?/, '/'));
      expect(href.searchParams.get('type')).toBe(viewType === 'all' ? 'all' : null);
    });
  });

  it('reads a rent drill-down URL back as rent homes only, on a direct load', async () => {
    const query = `${extra}neighborhood=Kingstowne&city=Alexandria&state=VA&groupFrom=Alexandria%7CVA%7Call`;
    window.history.replaceState(null, '', `${c.prefix}/homes-for-rent?${query}`);
    render(
      <SearchExperience
        initialQuery={query}
        place={
          {
            ...c.place,
            filters: { ...c.place.filters, listingType: 'rent' },
            query: '',
          } as never
        }
      />,
    );
    await waitFor(() =>
      expect(mockedSearch.mock.calls.at(-1)?.[0]).toMatchObject({
        listingType: 'rent',
        neighborhood: 'Kingstowne',
      }),
    );
    expect(screen.getByLabelText('Open filters').textContent).toBe('Filters');
    expect(screen.getByTestId('back-to-neighborhoods')).toBeTruthy();
  });
});
