import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MapBounds } from '@cribstop/property-contracts';
import {
  getBrokerGroups,
  getNeighborhoodGroups,
  getZipGroups,
  searchListings,
} from '@/lib/api/listings';
import { areaToParam, type LngLat, ringToGeoJson } from '@/lib/draw-area';
import SearchExperience from './SearchExperience';

/**
 * A drawn area as a filter (#747). The map is mocked: it hands back its props, so a test can call
 * `onAreaDrawn` the way the real map does after a finished draw. The gesture and the shape maths
 * are tested in `lib/draw-gesture.spec.ts`, `lib/draw-area.spec.ts` and `MapDrawLayer.spec.tsx`.
 */

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoodGroups: jest.fn(),
  getZipGroups: jest.fn(),
  getBrokerGroups: jest.fn(),
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
  area: string | null;
  onUserMove: (bounds: MapBounds) => void;
  onAreaDrawn: (area: string) => void;
  onAreaClear: () => void;
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

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

const mockedSearch = searchListings as jest.Mock;
const mockedGroups = getNeighborhoodGroups as jest.Mock;
const mockedZips = getZipGroups as jest.Mock;
const mockedBrokers = getBrokerGroups as jest.Mock;

type Query = Record<string, unknown> & { bounds?: MapBounds; area?: string; page?: number };
const lastQuery = () => mockedSearch.mock.calls.at(-1)?.[0] as Query;
const params = () => new URLSearchParams(window.location.search);

const RING: LngLat[] = [
  [-77.06, 38.79],
  [-77.04, 38.79],
  [-77.04, 38.81],
  [-77.06, 38.81],
  [-77.06, 38.79],
];
const AREA = ringToGeoJson(RING);
const AREA_PARAM_VALUE = areaToParam(AREA) as string;
const OTHER = ringToGeoJson([
  [-77.1, 38.85],
  [-77.08, 38.85],
  [-77.08, 38.87],
  [-77.1, 38.85],
]);
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

const draw = (area: string) => act(() => mockMapProps.current?.onAreaDrawn(area));
const moveMap = (bounds: MapBounds) => act(() => mockMapProps.current?.onUserMove(bounds));
const popTo = (search: string) =>
  act(() => {
    window.history.replaceState(null, '', `/search${search}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

beforeEach(() => {
  mockedSearch.mockResolvedValue(envelope());
  mockedGroups.mockResolvedValue({ results: [], total: 0 });
  mockedZips.mockResolvedValue({ groups: [], total: 0, listingTotal: 0 });
  mockedBrokers.mockResolvedValue({ groups: [], total: 0, listingTotal: 0 });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Alexandria%2C+VA');
  mockMapProps.current = null;
});

afterEach(() => {
  mockedSearch.mockReset();
  mockedGroups.mockReset();
  mockedZips.mockReset();
  mockedBrokers.mockReset();
});

describe('a drawn area narrows the search', () => {
  it('sends the shape with the place and every filter, from page 1, with the new count', async () => {
    window.history.replaceState(null, '', '/search?q=Alexandria%2C+VA&beds=2&page=3');
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&beds=2&page=3" />);
    await waitFor(() => expect(lastQuery().page).toBe(3));
    expect(lastQuery().area).toBeUndefined();
    expect(screen.queryByTestId('clear-drawn-area')).toBeNull();

    mockedSearch.mockResolvedValue(envelope(17));
    draw(AREA);

    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    expect(lastQuery()).toMatchObject({ page: 1, beds: 2, query: 'Alexandria, VA' });
    await waitFor(() => expect(screen.getByText('17')).toBeTruthy());
    expect(mockMapProps.current?.area).toBe(AREA);
  });

  it('sends the shape to the map pins, which add their own view', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);

    await waitFor(() => expect(mockMapProps.current?.filters.area).toBe(AREA));
    expect(mockMapProps.current?.filters).not.toHaveProperty('bounds');
  });
});

describe('a drawn area wins over the viewport', () => {
  it('removes the viewport filter and its URL parameter when a shape applies', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    moveMap(OLD_TOWN);
    await waitFor(() => expect(lastQuery().bounds).toEqual(OLD_TOWN));
    expect(params().has('viewport')).toBe(true);

    draw(AREA);

    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    expect(lastQuery().bounds).toBeUndefined();
    expect(params().has('viewport')).toBe(false);
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
    expect(screen.getByTestId('clear-drawn-area')).toBeTruthy();
  });

  it('never sets a viewport on pan or zoom while the shape is active', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    const calls = mockedSearch.mock.calls.length;

    moveMap(FAR_AWAY);

    expect(mockedSearch.mock.calls.length).toBe(calls);
    expect(lastQuery().bounds).toBeUndefined();
    expect(params().has('viewport')).toBe(false);
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
  });

  it('reads a link that carries both as the area alone', async () => {
    const search = `?q=Alexandria%2C+VA&viewport=-77.0602,38.7977,-77.0301,38.8189&area=${AREA_PARAM_VALUE}`;
    window.history.replaceState(null, '', `/search${search}`);
    render(<SearchExperience initialQuery={search.slice(1)} />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(lastQuery().area).toBe(AREA);
    expect(lastQuery().bounds).toBeUndefined();
    expect(screen.queryByTestId('clear-map-area')).toBeNull();
  });
});

describe('the URL carries the drawn area', () => {
  it('pushes a history entry on apply and writes lng,lat pairs with five decimals', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&page=2" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    const push = jest.spyOn(window.history, 'pushState');
    const replace = jest.spyOn(window.history, 'replaceState');

    draw(AREA);

    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(params().get('area')).toBe(
      '-77.06000,38.79000;-77.04000,38.79000;-77.04000,38.81000;-77.06000,38.81000',
    );
    expect(params().has('page')).toBe(false);
    expect(params().get('q')).toBe('Alexandria, VA');
    push.mockRestore();
    replace.mockRestore();
  });

  it('restores the shape from a shared link with one request and no wider one first', async () => {
    const search = `?q=Alexandria%2C+VA&area=${AREA_PARAM_VALUE}`;
    window.history.replaceState(null, '', `/search${search}`);
    render(<SearchExperience initialQuery={search.slice(1)} />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(mockedSearch.mock.calls).toHaveLength(1);
    expect(lastQuery().area).toBe(AREA);
    expect(mockMapProps.current?.area).toBe(AREA);
    expect(screen.getByTestId('clear-drawn-area')).toBeTruthy();
  });

  it('drops a shape the service would refuse instead of sending a request it rejects', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA&area=0,0;2,2;2,0;0,2" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(lastQuery().area).toBeUndefined();
    expect(screen.queryByTestId('clear-drawn-area')).toBeNull();
  });

  it('removes the shape on Back and restores it on Forward', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    const withArea = window.location.search;

    popTo('?q=Alexandria%2C+VA');
    await waitFor(() => expect(lastQuery().area).toBeUndefined());
    expect(screen.queryByTestId('clear-drawn-area')).toBeNull();
    expect(mockMapProps.current?.area).toBeNull();

    popTo(withArea);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    expect(mockMapProps.current?.area).toBe(AREA);
  });
});

describe('clear and redraw', () => {
  it('clears from the chip: full results, URL without the shape, one history entry', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    const push = jest.spyOn(window.history, 'pushState');

    fireEvent.click(screen.getByTestId('clear-drawn-area'));

    await waitFor(() => expect(lastQuery().area).toBeUndefined());
    expect(lastQuery().page).toBe(1);
    expect(params().has('area')).toBe(false);
    expect(params().get('q')).toBe('Alexandria, VA');
    expect(push).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('clear-drawn-area')).toBeNull();
    push.mockRestore();
  });

  it('clears from the map control', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));

    act(() => mockMapProps.current?.onAreaClear());

    await waitFor(() => expect(lastQuery().area).toBeUndefined());
    expect(params().has('area')).toBe(false);
  });

  it('replaces the old shape with a new one', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));

    draw(OTHER);

    await waitFor(() => expect(lastQuery().area).toBe(OTHER));
    expect(params().getAll('area')).toHaveLength(1);
    expect(params().get('area')).toBe(areaToParam(OTHER));
  });

  it('keeps the shape when the filter modal applies a draft', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);
    await waitFor(() => expect(lastQuery().area).toBe(AREA));

    fireEvent.click(screen.getByLabelText('Open filters'));
    fireEvent.click(screen.getByRole('button', { name: /^Show \d+ homes?$/ }));

    await waitFor(() => expect(lastQuery().area).toBe(AREA));
    expect(params().has('area')).toBe(true);
  });

  it('explains an empty shape and clears it', async () => {
    render(<SearchExperience initialQuery="q=Alexandria%2C+VA" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    draw(AREA);

    await waitFor(() => expect(screen.getByText('No homes in your drawn area')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'Show all in Alexandria, VA' }).at(-1)!);

    await waitFor(() => expect(lastQuery().area).toBeUndefined());
  });
});

describe('every group-by uses the shape', () => {
  const lastArg = (mock: jest.Mock) => mock.mock.calls.at(-1)?.[0] as Query;

  it('applies to neighborhood groups', async () => {
    const search = `?q=Alexandria%2C+VA&groupBy=neighborhood&area=${AREA_PARAM_VALUE}`;
    window.history.replaceState(null, '', `/search${search}`);
    render(<SearchExperience initialQuery={search.slice(1)} />);

    await waitFor(() => expect(mockedGroups).toHaveBeenCalled());
    expect(lastArg(mockedGroups).area).toBe(AREA);
  });

  it('applies to ZIP code groups, the probe and the page', async () => {
    mockedZips.mockResolvedValue({
      groups: [{ key: '22314', count: 2 }],
      total: 2,
      listingTotal: 2,
    });
    const search = `?q=Alexandria%2C+VA&groupBy=zip&area=${AREA_PARAM_VALUE}`;
    window.history.replaceState(null, '', `/search${search}`);
    render(<SearchExperience initialQuery={search.slice(1)} />);

    await waitFor(() => expect(mockedZips.mock.calls.length).toBeGreaterThan(1));
    for (const call of mockedZips.mock.calls) expect((call[0] as Query).area).toBe(AREA);
  });

  it('applies to broker groups', async () => {
    const search = `?q=Alexandria%2C+VA&groupBy=broker&area=${AREA_PARAM_VALUE}`;
    window.history.replaceState(null, '', `/search${search}`);
    render(<SearchExperience initialQuery={search.slice(1)} />);

    await waitFor(() => expect(mockedBrokers).toHaveBeenCalled());
    expect(lastArg(mockedBrokers).area).toBe(AREA);
  });

  it('sends a newly drawn shape to the group request too', async () => {
    const search = '?q=Alexandria%2C+VA&groupBy=broker';
    window.history.replaceState(null, '', `/search${search}`);
    render(<SearchExperience initialQuery={search.slice(1)} />);
    await waitFor(() => expect(mockedBrokers).toHaveBeenCalled());
    expect(lastArg(mockedBrokers).area).toBeUndefined();

    draw(AREA);

    await waitFor(() => expect(lastArg(mockedBrokers).area).toBe(AREA));
  });
});
