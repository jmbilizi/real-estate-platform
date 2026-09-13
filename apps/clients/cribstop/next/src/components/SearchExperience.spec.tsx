import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { maxReachablePage, PAGE_SIZE_DEFAULT } from '@cribstop/property-contracts';
import { ListingsApiError, searchListings } from '@/lib/api/listings';
import { aListingCardRow } from '@/test/fixtures';
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
  // Carries `code` and `status` like the real one. A bare `class extends Error {}` was enough while
  // nothing branched on the code, but `useListingSearch` now reports it so the UI can tell a
  // deterministic failure (a page past the result window, #65) from a retryable one — a mock
  // without it would make every error look retryable and the branch untestable.
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

/**
 * The API bounds paging depth (#65): a request whose offset exceeds `MAX_RESULT_OFFSET` is a 400.
 * `pageCount` is deliberately NOT clamped to that window server-side — it is derived from the exact
 * `total` — so the pager has to do the clamping, or the shipped UI renders a "last page" button
 * that fails when clicked. That is invisible against the seeded dataset and guaranteed once a real
 * IDX feed is behind the endpoint.
 */
describe('SearchExperience never offers a page the API will refuse', () => {
  const LAST_REACHABLE = maxReachablePage(PAGE_SIZE_DEFAULT);

  // The pager renders only alongside results, so every envelope here carries a row. One is enough
  // — these tests are about which page buttons exist, not about the grid.
  const withResults = (total: number, pageCount: number) => ({
    ...envelope(),
    results: [aListingCardRow()],
    total,
    pageCount,
  });

  /** A result set far larger than the window: 200,000 rows is 10,000 pages at the default size. */
  const hugeEnvelope = withResults(200_000, 10_000);

  const pageButtonLabels = () =>
    screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((label) => label !== undefined && /^\d+$/.test(label));

  it('caps the highest offered page at the deepest reachable one, not at pageCount', async () => {
    mockedSearchListings.mockResolvedValue(hugeEnvelope);

    render(<SearchExperience initialQuery="q=Alexandria" />);

    await waitFor(() => expect(pageButtonLabels()).toContain(String(LAST_REACHABLE)));
    expect(pageButtonLabels()).not.toContain('10000');
    for (const label of pageButtonLabels()) {
      expect(Number(label)).toBeLessThanOrEqual(LAST_REACHABLE);
    }
  });

  it('disables Next on the deepest reachable page rather than stepping past the window', async () => {
    mockedSearchListings.mockResolvedValue(hugeEnvelope);

    render(<SearchExperience initialQuery={`q=Alexandria&page=${LAST_REACHABLE}`} />);

    await waitFor(() => expect(lastRequestedPage()).toBe(LAST_REACHABLE));
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });

  it('clamps against the page size the API applied, not an assumed one', async () => {
    // The limit is on the offset, so the deepest reachable page moves with page size. A response
    // that says `pageSize: 100` means page 11 is the last reachable one, whatever the request's
    // default happens to be.
    mockedSearchListings.mockResolvedValue({ ...withResults(200_000, 2_000), pageSize: 100 });

    render(<SearchExperience initialQuery="q=Alexandria" />);

    await waitFor(() => expect(pageButtonLabels()).toContain(String(maxReachablePage(100))));
    for (const label of pageButtonLabels()) {
      expect(Number(label)).toBeLessThanOrEqual(maxReachablePage(100));
    }
  });

  it('offers a way back to page 1 — not a retry that cannot succeed — when the URL asks past the window', async () => {
    // Reachable by hand-editing `?page=`, an old bookmark, or a link minted before the bound
    // existed. The pager lives in the results branch, so without this the user has no in-page
    // route back at all.
    mockedSearchListings.mockRejectedValue(
      new ListingsApiError(
        'That is further than search results go.',
        'result_window_exceeded',
        400,
      ),
    );

    render(<SearchExperience initialQuery="q=Alexandria&page=200" />);

    const action = await screen.findByRole('button', { name: 'Back to the first page' });
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    mockedSearchListings.mockResolvedValue(withResults(60, 3));
    fireEvent.click(action);

    await waitFor(() => expect(lastRequestedPage()).toBe(1));
  });

  it('still offers a retry for an ordinary failure', async () => {
    mockedSearchListings.mockRejectedValue(
      new ListingsApiError('We could not load listings just now.', 'internal_error', 500),
    );

    render(<SearchExperience initialQuery="q=Alexandria" />);

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('still offers every page when the result set fits inside the window', async () => {
    // The clamp must not cost a shopper any page they could actually reach — it is a ceiling, not
    // a shortening of ordinary result sets.
    mockedSearchListings.mockResolvedValue(withResults(60, 3));

    render(<SearchExperience initialQuery="q=Alexandria" />);

    await waitFor(() => expect(pageButtonLabels()).toContain('3'));
    expect(pageButtonLabels()).toEqual(['1', '2', '3']);
  });
});
