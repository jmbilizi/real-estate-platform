import { fireEvent, render, screen } from '@testing-library/react';
import type { SearchPlace } from '@cribstop/property-contracts';
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
  mockPush.mockReset();
});

const COUNTY: SearchPlace = { kind: 'county', county: 'Fairfax County', state: 'VA' };
const CITY: SearchPlace = { kind: 'city', city: 'Alexandria', state: 'VA' };

/** `from` is what the arrow needs beyond the path. The cases cover every grouped-view scope. */
const CASES = [
  {
    scope: 'city path',
    url: '/alexandria-va/homes-for-sale',
    place: {
      filters: { city: 'Alexandria', state: 'VA' },
      label: 'Alexandria, VA',
      searchPlace: CITY,
    },
    scopeToken: '',
  },
  {
    scope: 'county path',
    url: '/fairfax-county-va/homes-for-sale',
    place: {
      filters: { state: 'VA', boundary: '{"type":"Polygon"}' },
      label: 'Fairfax County, VA',
      searchPlace: COUNTY,
    },
    scopeToken: 'fairfax-county-va',
  },
  {
    scope: 'state path',
    url: '/homes-for-sale',
    place: { filters: { state: 'VA' }, label: '', searchPlace: null },
    scopeToken: 'VA',
    extra: 'state=VA&',
  },
  {
    scope: 'no-region path',
    url: '/homes-for-sale',
    place: { filters: {}, label: '', searchPlace: null },
    scopeToken: 'us',
  },
] as const;

const NEIGHBORHOOD = '/alexandria-va/kingstowne-neighborhood';

/** The `from` value for a drill-down, or none when the arrow's default target is right. */
const fromFor = (scopeToken: string, groupedType: string, type: string) => {
  const typePart = groupedType === type ? '' : `.${groupedType}`;
  return scopeToken || typePart ? `${scopeToken || 'city'}${typePart}` : null;
};

describe.each(CASES)('count links on a $scope (#528, #533)', (c) => {
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
      expect(href.pathname).toBe(`${NEIGHBORHOOD}/homes-for-rent`);
      expect([...href.searchParams.keys()].sort()).toEqual(
        fromFor(c.scopeToken, viewType, 'rent') ? ['from'] : [],
      );
      expect(href.searchParams.get('from')).toBe(fromFor(c.scopeToken, viewType, 'rent'));
    });

    it('opens exactly the sale homes for the sale count', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      const link = await screen.findByRole('link', { name: /for sale in Kingstowne/ });
      expect(link.textContent).toContain('28');
      const href = await hrefOf(/for sale in Kingstowne/);
      expect(href.pathname).toBe(`${NEIGHBORHOOD}/homes-for-sale`);
      expect(href.searchParams.has('type')).toBe(false);
      expect(href.searchParams.get('from')).toBe(fromFor(c.scopeToken, viewType, 'sale'));
    });

    it('keeps the grouped view type on the name link', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      const href = await hrefOf(/^Kingstowne$/);
      expect(href.pathname).toBe(`${NEIGHBORHOOD}/homes-for-sale`);
      expect(href.searchParams.get('type')).toBe(viewType === 'all' ? 'all' : null);
      expect(href.searchParams.get('from')).toBe(fromFor(c.scopeToken, viewType, viewType));
    });

    it('repeats no value of the path in the query', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      for (const name of [/^Kingstowne$/, /for sale in Kingstowne/, /for rent in Kingstowne/]) {
        const href = await hrefOf(name);
        for (const key of ['city', 'state', 'neighborhood', 'groupFrom', 'groupBy']) {
          expect(href.searchParams.has(key)).toBe(false);
        }
      }
    });

    it('goes to the link on a click, so that the URL is the shareable one', async () => {
      render(<SearchExperience initialQuery={query} place={place} />);
      const link = await screen.findByRole('link', { name: /for rent in Kingstowne/ });
      fireEvent.click(link);
      expect(mockPush).toHaveBeenCalledWith(link.getAttribute('href'));
    });
  });
});
