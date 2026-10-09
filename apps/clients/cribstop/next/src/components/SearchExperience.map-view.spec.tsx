import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MapBounds } from '@cribstop/property-contracts';
import { getNeighborhoodGroups, searchListings } from '@/lib/api/listings';
import SearchExperience from './SearchExperience';

/**
 * The map view as a filter on the results (#558). The map is mocked: it hands back its props, so a
 * test can call `onUserMove` the way the real map does after the debounce. The debounce and the
 * user-versus-program rule are tested in `lib/user-move-gate.spec.ts`.
 */

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoodGroups: jest.fn(),
  getZipGroups: jest.fn(() => Promise.resolve({ groups: [], total: 0, listingTotal: 0 })),
  getBrokerGroups: jest.fn(() => Promise.resolve({ groups: [], total: 0, listingTotal: 0 })),
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

interface MapProps {
  filters: Record<string, unknown>;
  viewBounds: MapBounds | null;
  onUserMove: (bounds: MapBounds) => void;
}
const mockMapProps: { current: MapProps | null } = { current: null };

jest.mock('@/components/ListingsMap', () => ({
  __esModule: true,
  default: (props: unknown) => {
    mockMapProps.current = props as MapProps;
    return <div data-testid="map" />;
  },
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

type Query = Record<string, unknown> & { bounds?: MapBounds; page?: number };
const lastQuery = () => mockedSearch.mock.calls.at(-1)?.[0] as Query;
const lastSignal = () => mockedSearch.mock.calls.at(-1)?.[1] as AbortSignal;
const queries = () => mockedSearch.mock.calls.map((call) => call[0] as Query);
const params = () => new URLSearchParams(window.location.search);

const OLD_TOWN: MapBounds = { west: -77.0602, south: 38.7977, east: -77.0301, north: 38.8189 };
const FAR_AWAY: MapBounds = { west: -105.31, south: 39.97, east: -105.2, north: 40.05 };

const envelope = (total = 0) => ({
  results: [],
  total,
  page: 1,
  pageSize: 20,
  pageCount: 1,
  appliedFilters: {},
});

const moveMap = (bounds: MapBounds) => act(() => mockMapProps.current?.onUserMove(bounds));

const row = (name: string) => ({
  key: `va|alexandria|${name}`.toLowerCase(),
  name,
  city: 'Alexandria',
  state: 'VA',
  slug: name.toLowerCase(),
  total: 4,
  sale: 3,
  rent: 1,
  centroid: null,
  bounds: null,
});

beforeEach(() => {
  mockedSearch.mockResolvedValue(envelope());
  mockedGroups.mockResolvedValue({ results: [row('Old Town')], total: 1 });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Alexandria%2C+VA');
  mockMapProps.current = null;
});

afterEach(() => {
  mockedSearch.mockReset();
  mockedGroups.mockReset();
  mockPush.mockReset();
});

describe('the map view starts only after the user moves the map', () => {
  it('sends no bounds on the first load and shows no map-area control', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(lastQuery().bounds).toBeUndefined();
    expect(mockMapProps.current?.viewBounds).toBeNull();
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
    expect(params().has('viewport')).toBe(false);
  });

  it('filters the list by the view, resets to page 1 and updates the count', async () => {
    mockedSearch.mockResolvedValueOnce(envelope(240));
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&page=3" />);
    await waitFor(() => expect(lastQuery().page).toBe(3));

    mockedSearch.mockResolvedValue(envelope(31));
    moveMap(OLD_TOWN);

    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    expect(lastQuery().page).toBe(1);
    expect(lastQuery().query).toBe('Alexandria, VA');
    await waitFor(() => expect(screen.getByText('31')).toBeTruthy());
    expect(screen.getByTestId('clear-map-area')).toBeTruthy();
    expect(screen.queryByTestId('map-area-note')).toBeNull();
    expect(mockMapProps.current?.viewBounds).toEqual(OLD_TOWN);
  });

  it('keeps the viewport out of the map pin request, which reads its own view', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);

    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    expect(mockMapProps.current?.filters).not.toHaveProperty('bounds');
  });

  it('rounds the view, so a one-meter pan is not a new request', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    const calls = mockedSearch.mock.calls.length;

    moveMap({ ...OLD_TOWN, west: OLD_TOWN.west + 0.000001 });

    expect(mockedSearch.mock.calls.length).toBe(calls);
  });

  it('cancels the in-flight list request when the view moves again', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    mockedSearch.mockReturnValue(new Promise(() => undefined));
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    const first = lastSignal();
    expect(first.aborted).toBe(false);

    moveMap({ ...OLD_TOWN, west: -77.1, east: -77.07 });

    await waitFor(() => expect(first.aborted).toBe(true));
    expect(lastSignal().aborted).toBe(false);
  });
});

describe('the URL carries the map view', () => {
  it('writes bounds with replaceState and drops the page', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&page=2" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    const entries = window.history.length;
    const replace = jest.spyOn(window.history, 'replaceState');
    const push = jest.spyOn(window.history, 'pushState');

    moveMap(OLD_TOWN);

    expect(params().get('viewport')).toBe('-77.06020,38.79770,-77.03010,38.81890');
    expect(params().has('page')).toBe(false);
    expect(params().get('q')).toBe('Alexandria, VA');
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.history.length).toBe(entries);
    replace.mockRestore();
    push.mockRestore();
  });

  it('restores the same view and list on a direct load, with one request and no wider one first', async () => {
    window.history.replaceState(
      null,
      '',
      '/search?q=Alexandria%2C+VA&viewport=-77.0602,38.7977,-77.0301,38.8189',
    );
    render(
      <SearchExperience initialQuery="q=Alexandria%2C+VA&viewport=-77.0602,38.7977,-77.0301,38.8189" />,
    );
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(queries()).toHaveLength(1);
    expect(lastQuery().bounds).toEqual(OLD_TOWN);
    expect(mockMapProps.current?.viewBounds).toEqual(OLD_TOWN);
    expect(screen.getByTestId('clear-map-area')).toBeTruthy();
  });

  it('drops a malformed bounds value instead of sending a request the API rejects', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&viewport=-77,38,-78,39" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(lastQuery().bounds).toBeUndefined();
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
  });

  it('follows Back and Forward between a view and the whole place', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    const withView = window.location.search;

    act(() => {
      window.history.replaceState(null, '', '/search?q=Alexandria%2C+VA');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(lastQuery().bounds).toBeUndefined());
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
    expect(mockMapProps.current?.viewBounds).toBeNull();

    act(() => {
      window.history.replaceState(null, '', `/search${withView}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    expect(mockMapProps.current?.viewBounds).toEqual(OLD_TOWN);
  });
});

describe('the way back to the whole place', () => {
  it('clears the view: full results, URL without bounds, map free to fit the place', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));

    fireEvent.click(screen.getByTestId('clear-map-area'));

    await waitFor(() => expect(lastQuery().bounds).toBeUndefined());
    expect(lastQuery().page).toBe(1);
    expect(params().has('viewport')).toBe(false);
    expect(params().get('q')).toBe('Alexandria, VA');
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
    expect(mockMapProps.current?.viewBounds).toBeNull();
  });

  it('clears the map area from the chip', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(screen.getByTestId('clear-map-area')).toBeTruthy());

    fireEvent.click(screen.getByTestId('clear-map-area'));

    await waitFor(() => expect(lastQuery().bounds).toBeUndefined());
  });

  it('explains an empty view and clears it', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);

    await waitFor(() => expect(screen.getByText('No homes in this map area')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'Show all in Alexandria, VA' }).at(-1)!);

    await waitFor(() => expect(lastQuery().bounds).toBeUndefined());
  });
});

describe('the view works with the other controls', () => {
  it('keeps filters in the request and the view in the URL', async () => {
    window.history.replaceState(null, '', '/search?q=Alexandria%2C+VA&beds=2&minPrice=300000');
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&beds=2&minPrice=300000" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    moveMap(OLD_TOWN);

    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    expect(lastQuery()).toMatchObject({ beds: 2, minPrice: 300000, query: 'Alexandria, VA' });
    expect(params().get('beds')).toBe('2');
    expect(params().has('viewport')).toBe(true);
  });

  it('keeps the view when the sort changes', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));

    fireEvent.click(screen.getByTestId('sort-control'));
    fireEvent.click(screen.getByRole('option', { name: 'Lowest price' }));

    await waitFor(() => expect(lastQuery().sort).toBe('price-asc'));
    expect(lastQuery().bounds).toEqual(OLD_TOWN);
    expect(params().has('viewport')).toBe(true);
  });

  it('keeps the newer map view when the filter modal applies an older draft', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));

    fireEvent.click(screen.getByLabelText('Open filters'));
    const newer = { ...OLD_TOWN, west: -77.1, east: -77.07 };
    moveMap(newer);
    await waitFor(() => expect(lastQuery().bounds).toEqual(newer));
    fireEvent.click(screen.getByRole('button', { name: /^Show homes/ }));

    await waitFor(() => expect(lastQuery().bounds).toEqual(newer));
    expect(params().get('viewport')).toBe('-77.10000,38.79770,-77.07000,38.81890');
  });

  it('drops the view when the URL changes to another place', async () => {
    const { rerender } = render(
      <SearchExperience initialQuery="q=Alexandria%2C+VA&viewport=-77.0602,38.7977,-77.0301,38.8189" />,
    );
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));

    rerender(<SearchExperience initialQuery="q=Arlington%2C+VA" />);

    await waitFor(() => expect(lastQuery().query).toBe('Arlington, VA'));
    expect(lastQuery().bounds).toBeUndefined();
    expect(mockMapProps.current?.viewBounds).toBeNull();
  });

  it('does not count the view as a filter', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));

    expect(screen.getByLabelText('Open filters').textContent).not.toMatch(/\d/);
  });

  it('keeps a search path place and ANDs the view with it', async () => {
    const place = {
      filters: { city: 'Alexandria', state: 'VA', listingType: 'sale' as const },
      label: 'Alexandria, VA',
    };
    render(<SearchExperience initialQuery="" place={place} />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    moveMap(OLD_TOWN);

    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    expect(lastQuery()).toMatchObject({ city: 'Alexandria', state: 'VA', listingType: 'sale' });
  });

  it('narrows the neighborhood cards in the grouped view and resets their page', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&groupBy=neighborhood&page=2" />);
    await waitFor(() => expect(mockedGroups).toHaveBeenCalled());
    expect((mockedGroups.mock.calls.at(-1)?.[0] as Query).bounds).toBeUndefined();

    moveMap(OLD_TOWN);

    await waitFor(() =>
      expect((mockedGroups.mock.calls.at(-1)?.[0] as Query).bounds).toEqual(OLD_TOWN),
    );
    expect(mockedGroups.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0 });
  });
});

describe('a search with no place', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/homes-for-sale');
  });

  it('uses the view alone as the area and follows the map anywhere', async () => {
    render(<SearchExperience initialQuery="" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    expect(lastQuery().bounds).toBeUndefined();

    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    moveMap(FAR_AWAY);

    await waitFor(() => expect(lastQuery().bounds).toEqual(FAR_AWAY));
    for (const key of ['query', 'city', 'state', 'zip', 'neighborhood', 'boundary']) {
      expect(lastQuery()).not.toHaveProperty(key);
    }
    expect(screen.getAllByRole('button', { name: 'Show all homes' }).length).toBeGreaterThan(0);
  });

  it('restores the view from a direct load of the URL', async () => {
    window.history.replaceState(null, '', '/homes-for-sale?viewport=-105.31,39.97,-105.2,40.05');
    render(<SearchExperience initialQuery="viewport=-105.31,39.97,-105.2,40.05" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(queries()).toHaveLength(1);
    expect(lastQuery().bounds).toEqual(FAR_AWAY);
    expect(mockMapProps.current?.viewBounds).toEqual(FAR_AWAY);
  });

  it('clears back to every match', async () => {
    render(<SearchExperience initialQuery="" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(FAR_AWAY);
    await waitFor(() => expect(lastQuery().bounds).toEqual(FAR_AWAY));

    fireEvent.click(screen.getByTestId('clear-map-area'));

    await waitFor(() => expect(lastQuery().bounds).toBeUndefined());
    expect(params().has('viewport')).toBe(false);
  });
});
