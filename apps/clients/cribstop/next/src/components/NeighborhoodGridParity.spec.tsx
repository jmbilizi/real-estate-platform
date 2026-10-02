import { fireEvent, render, screen } from '@testing-library/react';
import { getNeighborhoodGroups, searchListings } from '@/lib/api/listings';
import { aListingCardRow } from '@/test/fixtures';
import { RESULTS_GRID_COLUMNS_CLASS, RESULTS_GRID_GAP_CLASS } from './resultsGridColumns';
import { NeighborhoodGroupGridSkeleton } from './NeighborhoodGroupGrid';
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

const columnsOf = (el: Element | null) =>
  (el?.className ?? '').split(' ').filter((c) => /grid-cols-/.test(c));
const SHARED = RESULTS_GRID_COLUMNS_CLASS.split(' ');
const gapOf = (el: Element | null) =>
  (el?.className ?? '').split(' ').filter((c) => /(^|:)gap-/.test(c));
const SHARED_GAP = RESULTS_GRID_GAP_CLASS.split(' ');

// The first render of SearchExperience compiles a large import graph.
jest.setTimeout(30000);
beforeEach(() => {
  (searchListings as jest.Mock).mockResolvedValue({
    results: [aListingCardRow()],
    total: 1,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    appliedFilters: {},
  });
  (getNeighborhoodGroups as jest.Mock).mockResolvedValue({
    results: [
      {
        key: 'md|bethesda|chevy chase',
        name: 'Chevy Chase',
        city: 'Bethesda',
        state: 'MD',
        slug: 'chevy-chase',
        total: 4,
        sale: 3,
        rent: 1,
        centroid: null,
        bounds: null,
      },
    ],
    total: 1,
  });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Bethesda');
});

/** #517: a neighborhood card and a listing card show the same cards per row. */
describe('results grid parity between neighborhood and listing cards (#517)', () => {
  it('gives the listing grid and the neighborhood grid the shared columns', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    const listingGrid = (await screen.findByText(/100 Test St/)).closest('[class*="grid-cols"]');
    expect(columnsOf(listingGrid)).toEqual(SHARED);

    fireEvent.click(screen.getByTestId('group-by-control'));
    fireEvent.click(screen.getByRole('option', { name: 'Neighborhood' }));
    const hoodGrid = await screen.findByTestId('neighborhood-group-grid');
    expect(columnsOf(hoodGrid)).toEqual(SHARED);
    expect(gapOf(listingGrid)).toEqual(SHARED_GAP);
    expect(gapOf(hoodGrid)).toEqual(SHARED_GAP);
  });

  it('gives the neighborhood skeleton the shared columns', () => {
    render(<NeighborhoodGroupGridSkeleton />);
    const skeleton = screen.getByTestId('neighborhood-group-skeleton');
    expect(columnsOf(skeleton)).toEqual(SHARED);
    expect(gapOf(skeleton)).toEqual(SHARED_GAP);
  });
});
