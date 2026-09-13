import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { searchListings } from '@/lib/api/listings';
import { PARCEL_INTERLOCK_HINT } from '@/lib/store/types';
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

/**
 * What this suite exists to stop (#77).
 *
 * The filter modal collected a full Zillow-shaped filter set and threw every value away: its
 * `onShow` callback was wired to the parent's `onClose`, a `() => void`. The modal closed, the URL
 * did not change, no new request went out, and the user was left believing the results in front of
 * them had been narrowed. A control that pretends to filter is worse than no control.
 *
 * These tests assert on the two things that are true of a filter that really filters — **the URL
 * changed** and **the request changed** — rather than on what the modal drew, because the drawing
 * was never the broken part.
 */
describe('the filter modal actually filters', () => {
  const openFilters = () => fireEvent.click(screen.getByLabelText('Open filters'));
  const showHomes = () =>
    fireEvent.click(screen.getByRole('button', { name: /^Show (homes|[\d,]+ home)/ }));

  /** The filters carried by the most recent `searchListings` call. */
  const lastRequest = () =>
    mockedSearchListings.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

  const currentParams = () => new URLSearchParams(window.location.search);

  it('puts an applied filter in the URL and in the request', async () => {
    render(<SearchExperience initialQuery="q=Alexandria" />);
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

    openFilters();
    fireEvent.click(screen.getByLabelText('More bedrooms'));
    fireEvent.click(screen.getByRole('button', { name: 'Pool' }));
    showHomes();

    // The URL is the shareable, refreshable source of truth — state alone is not a filtered search
    // anyone can link to or come back to.
    expect(currentParams().get('beds')).toBe('1');
    expect(currentParams().getAll('amenities')).toEqual(['Pool']);
    expect(currentParams().get('q')).toBe('Alexandria');

    await waitFor(() => expect(lastRequest()).toMatchObject({ beds: 1, amenities: ['Pool'] }));
  });

  it('survives a reload of the URL it wrote', async () => {
    render(<SearchExperience initialQuery="q=Alexandria" />);
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

    openFilters();
    fireEvent.click(screen.getByLabelText('More bedrooms'));
    showHomes();

    const shared = window.location.search;
    mockedSearchListings.mockClear();

    // Exactly what a refresh, a bookmark or a pasted link does: the page is built from the URL.
    render(<SearchExperience initialQuery={shared.replace(/^\?/, '')} />);

    await waitFor(() => expect(lastRequest()).toMatchObject({ beds: 1 }));
  });

  it('returns to page 1, because a filtered result set has no page 3 of the old one', async () => {
    render(<SearchExperience initialQuery="q=Alexandria&page=3" />);
    await waitFor(() => expect(lastRequestedPage()).toBe(3));

    openFilters();
    fireEvent.click(screen.getByLabelText('More bedrooms'));
    showHomes();

    // Left on page 3, a narrowed search lands past the end of its own results — an empty page at
    // best, and a `result_window_exceeded` 400 once paging depth is bounded (#65).
    await waitFor(() => expect(lastRequestedPage()).toBe(1));
    expect(currentParams().has('page')).toBe(false);
  });

  it('shows what is applied when it is reopened', async () => {
    // The modal used to keep its own state and was never handed the applied filters, so reopening
    // it showed defaults while the badge beside the button said three filters were active.
    render(
      <SearchExperience initialQuery="q=Alexandria&beds=3&propertyType=Condo&minPrice=500000" />,
    );
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

    openFilters();

    expect(screen.getByText('3+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Condo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Min price')).toHaveValue(500000);
  });

  it('clears a filter it no longer wants instead of leaving it in the URL', async () => {
    render(<SearchExperience initialQuery="q=Alexandria&beds=3" />);
    await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    showHomes();

    expect(currentParams().has('beds')).toBe(false);
    // Clearing filters does not throw away the place the user searched for.
    expect(currentParams().get('q')).toBe('Alexandria');
    await waitFor(() => expect(lastRequest()).toMatchObject({ query: 'Alexandria' }));
    expect(lastRequest()?.beds).toBeUndefined();
  });

  describe('the Lot/Land interlock', () => {
    it('clears and disables the dwelling controls when land is the only home type', async () => {
      render(<SearchExperience initialQuery="q=Alexandria&beds=3&minSqft=2000" />);
      await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

      openFilters();
      fireEvent.click(screen.getByRole('button', { name: /Land/ }));

      // Cleared *and* disabled, with the one visible explanation — a parcel has no bedrooms, so
      // `propertyType=Land&beds=3` is a guaranteed empty page with nothing on screen to explain it.
      expect(screen.getByLabelText('More bedrooms')).toBeDisabled();
      expect(screen.getByLabelText('Fewer bedrooms')).toBeDisabled();
      expect(screen.getByLabelText('Min square feet')).toBeDisabled();
      expect(screen.getByText(PARCEL_INTERLOCK_HINT)).toBeInTheDocument();

      showHomes();

      expect(currentParams().get('propertyType')).toBe('Land');
      expect(currentParams().has('beds')).toBe(false);
      expect(currentParams().has('minSqft')).toBe(false);
    });

    it('leaves the dwelling controls alone for a home type that has bedrooms', async () => {
      render(<SearchExperience initialQuery="q=Alexandria&beds=3" />);
      await waitFor(() => expect(mockedSearchListings).toHaveBeenCalled());

      openFilters();
      fireEvent.click(screen.getByRole('button', { name: /Condo/ }));

      expect(screen.getByLabelText('More bedrooms')).toBeEnabled();
      expect(screen.queryByText(PARCEL_INTERLOCK_HINT)).not.toBeInTheDocument();

      showHomes();

      expect(currentParams().get('beds')).toBe('3');
    });
  });
});

/**
 * A search that matched nothing, a search still running, and a search that failed are three
 * different things, and a user who cannot tell them apart reads all three as a broken site.
 */
describe('an empty result set is not a failure and not a load', () => {
  it('says so plainly, and offers the action that widens the search', async () => {
    mockedSearchListings.mockResolvedValue({ ...envelope(), results: [], total: 0 });

    render(<SearchExperience initialQuery="q=Alexandria&beds=5" />);

    const empty = await screen.findByTestId('search-empty-state');
    expect(empty).toHaveTextContent('No homes match your filters');
    // Distinct from the error surface, which is the only thing rendering role="alert" here.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));

    // It used to call `window.location.reload()`, which reloaded the same filtered URL and
    // therefore cleared nothing at all.
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has('beds')).toBe(false),
    );
  });

  it('does not offer to clear filters when there are none to clear', async () => {
    mockedSearchListings.mockResolvedValue({ ...envelope(), results: [], total: 0 });

    render(<SearchExperience initialQuery="q=Alexandria" />);

    const empty = await screen.findByTestId('search-empty-state');
    expect(empty).toHaveTextContent('No homes to show here');
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).not.toBeInTheDocument();
  });
});
