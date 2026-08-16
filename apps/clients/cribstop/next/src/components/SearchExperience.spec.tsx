import { render, waitFor } from '@testing-library/react';
import { searchListings } from '@/lib/api/listings';
import SearchExperience from './SearchExperience';

/**
 * What this suite exists to stop.
 *
 * Next does not remount a route segment when only its search parameters change — the router cache
 * key excludes them by design — so `router.push('/search?q=…')` from the search bar hands this same
 * component instance a new `initialQuery` prop and runs no `useState` initialiser again. When only
 * the location was re-seeded from that prop, searching a new city moved the search bar and the map
 * while the grid, the result count and the request all stayed on the previous city, indefinitely.
 *
 * These tests therefore assert on **what was requested**, not on what was drawn: the bug's signature
 * was the absence of a second request, which no rendering assertion can see.
 */

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  ListingsApiError: class extends Error {},
}));

// Neither the map nor the search bar is what these tests are about, and both pull in leaflet, the
// geocode calls and shared app state.
jest.mock('@/components/ListingsMap', () => ({
  __esModule: true,
  default: () => <div data-testid="map" />,
}));

jest.mock('@/components/CompactSearchBar', () => ({
  __esModule: true,
  default: () => <div data-testid="search-bar" />,
}));

// Error surfacing goes through the redux-backed toast; these tests never fail a request.
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

/*
 * The mocked app context must hand back the **same function identities** on every render, because
 * the real one does: every setter in `lib/context` is wrapped in `useCallback`, and the value object
 * is memoised.
 *
 * A mock that builds `jest.fn()`s inline returns fresh identities per render, which is not a
 * cosmetic infidelity — the re-seeding effect below depends on `setSearchLocation` and
 * `setSearchSuggestion`, so unstable identities re-run it after every render, and it sets a freshly
 * parsed `filters` object each time. That is an unbreakable render → effect → setState loop: this
 * file ran for over 400 seconds without finishing before the identities were hoisted. The stable
 * mock is the faithful one, and the infinite loop was the mock's, not the component's.
 */
// `mock`-prefixed so `jest.mock`'s hoisted factory is allowed to close over it.
const mockAppContext = {
  savedIds: new Set<string>(),
  setSearchLocation: jest.fn(),
  setSearchSuggestion: jest.fn(),
  toggleSave: jest.fn(),
  isSaved: () => false,
};

jest.mock('@/lib/context', () => ({
  useApp: () => mockAppContext,
}));

const mockedSearchListings = searchListings as jest.Mock;

const envelope = () => ({
  results: [],
  total: 0,
  page: 1,
  pageSize: 20,
  pageCount: 1,
  appliedFilters: {},
});

/**
 * Every `searchListings` call's query, in order.
 *
 * `searchListings(query, signal)` carries paging *inside* the query object — `useListingSearch`
 * calls it as `searchListings({ ...filters, page, pageSize }, signal)` — so the page is read off
 * argument 0, never a second positional argument.
 */
const requestedQueries = () =>
  mockedSearchListings.mock.calls.map((call) => (call[0] as { query?: string })?.query);

/** The page requested by the most recent `searchListings` call. */
const lastRequestedPage = () =>
  (mockedSearchListings.mock.calls.at(-1)?.[0] as { page?: number } | undefined)?.page;

beforeEach(() => {
  mockedSearchListings.mockResolvedValue(envelope());
  // The map's geocode goes through `fetch` directly; jsdom has none. Answering "no match" keeps the
  // map uncentred, which is irrelevant here and never throws.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Alexandria');
});

afterEach(() => {
  mockedSearchListings.mockReset();
  (global.fetch as jest.Mock).mockReset();
});

describe('SearchExperience follows the URL it is given', () => {
  it('searches the new city when handed a different query', async () => {
    const { rerender } = render(<SearchExperience initialQuery="q=Alexandria" />);
    await waitFor(() => expect(requestedQueries()).toContain('Alexandria'));

    rerender(<SearchExperience initialQuery="q=Washington%2C+DC" />);

    await waitFor(() => expect(requestedQueries()).toContain('Washington, DC'));
  });

  it('returns to page 1 when the new query carries no page', async () => {
    const { rerender } = render(<SearchExperience initialQuery="q=Alexandria&page=3" />);
    await waitFor(() => expect(lastRequestedPage()).toBe(3));

    rerender(<SearchExperience initialQuery="q=Washington%2C+DC" />);

    await waitFor(() => expect(lastRequestedPage()).toBe(1));
  });

  it('does not re-request when the same query is handed back', async () => {
    const { rerender } = render(<SearchExperience initialQuery="q=Alexandria" />);
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalledTimes(1));

    rerender(<SearchExperience initialQuery="q=Alexandria" />);

    // Re-seeding builds a new filters object every time; the search must key on its *value*, or
    // every parent re-render costs a round trip.
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalledTimes(1));
  });
});
