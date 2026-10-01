import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getNeighborhoodGroups, searchListings } from '@/lib/api/listings';
import SearchExperience from './SearchExperience';

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  getNeighborhoodGroups: jest.fn(),
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
  neighborhoods?: {
    rows: Array<{ key: string }>;
    activeKey: string | null;
    onActive: (key: string | null) => void;
    onSelect: (row: unknown) => void;
  };
  focusBounds: unknown;
}
// Named `mock*` so the module factory below may read it.
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

// Stable identities, like the real context: see the note in SearchExperience.spec.tsx.
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

const row = (name: string, city = 'Bethesda', state = 'MD') => ({
  key: `${state}|${city}|${name}`.toLowerCase(),
  name,
  city,
  state,
  slug: name.toLowerCase(),
  total: 4,
  sale: 3,
  rent: 1,
  centroid: null,
  bounds: null,
});

const choose = (control: string, option: string) => {
  fireEvent.click(screen.getByTestId(control));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const currentParams = () => new URLSearchParams(window.location.search);
const lastGroupQuery = () => mockedGroups.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  mockedSearch.mockResolvedValue({
    results: [],
    total: 0,
    page: 1,
    pageSize: 20,
    pageCount: 1,
    appliedFilters: {},
  });
  mockedGroups.mockResolvedValue({ results: [row('Chevy Chase'), row('Kensington')], total: 2 });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Bethesda');
});

afterEach(() => {
  mockedSearch.mockReset();
  mockedGroups.mockReset();
});

describe('Group by neighborhood (#502)', () => {
  it('does not request groups until the control is on, and is not a filter', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&beds=2" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());
    expect(mockedGroups).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Open filters').textContent).toContain('1');
  });

  it('shows neighborhood cards, writes groupBy to the URL and sends the search filters', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&beds=2" />);
    choose('group-by-control', 'Neighborhood');

    expect(await screen.findByTestId('neighborhood-group-grid')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Chevy Chase' })).toBeTruthy();
    expect(screen.getByText('neighborhoods')).toBeTruthy();
    expect(currentParams().get('groupBy')).toBe('neighborhood');
    expect(currentParams().get('beds')).toBe('2');
    expect(lastGroupQuery()).toMatchObject({
      beds: 2,
      minCount: 1,
      limit: 24,
      offset: 0,
      order: 'count',
    });
    expect(lastGroupQuery()).not.toHaveProperty('sort');
    expect(screen.getByLabelText('Open filters').textContent).toContain('1');
  });

  it('orders by name and keeps the order in the URL', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    await screen.findByTestId('neighborhood-group-grid');
    choose('group-order-control', 'Name A-Z');

    expect(currentParams().get('groupOrder')).toBe('name');
    await waitFor(() => expect(lastGroupQuery()).toMatchObject({ order: 'name' }));
  });

  it('loads the same grouped view from a shared URL', async () => {
    render(
      <SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood&groupOrder=name&page=2" />,
    );
    await waitFor(() => expect(lastGroupQuery()).toMatchObject({ order: 'name', offset: 24 }));
    expect(await screen.findByTestId('neighborhood-group-grid')).toBeTruthy();
  });

  it('drills into a neighborhood and offers the way back', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&beds=2&groupBy=neighborhood" />);
    const link = await screen.findByRole('link', { name: 'Chevy Chase' });
    expect(link.getAttribute('href')).toContain('neighborhood=Chevy+Chase');
    expect(link.getAttribute('href')).not.toContain('groupBy');

    fireEvent.click(link);

    expect(screen.queryByTestId('neighborhood-group-grid')).toBeNull();
    expect(currentParams().get('groupBy')).toBeNull();
    expect(currentParams().get('neighborhood')).toBe('Chevy Chase');
    expect(currentParams().get('city')).toBe('Bethesda');
    expect(currentParams().get('state')).toBe('MD');
    expect(currentParams().get('beds')).toBe('2');
    await waitFor(() =>
      expect(mockedSearch.mock.calls.at(-1)?.[0]).toMatchObject({
        neighborhood: 'Chevy Chase',
        city: 'Bethesda',
        state: 'MD',
        beds: 2,
      }),
    );

    fireEvent.click(screen.getByTestId('back-to-neighborhoods'));
    expect(currentParams().get('groupBy')).toBe('neighborhood');
    expect(currentParams().get('neighborhood')).toBeNull();
    expect(currentParams().get('beds')).toBe('2');
    expect(await screen.findByTestId('neighborhood-group-grid')).toBeTruthy();
  });

  it('restores a bare city and state scope on the way back', async () => {
    mockedGroups.mockResolvedValue({
      results: [row('Dupont Circle', 'Washington', 'DC')],
      total: 1,
    });
    render(<SearchExperience initialQuery="state=MD&groupBy=neighborhood" />);
    fireEvent.click(await screen.findByRole('link', { name: 'Dupont Circle' }));
    expect(currentParams().get('city')).toBe('Washington');
    expect(currentParams().get('state')).toBe('DC');
    expect(currentParams().get('groupFrom')).toBe('|MD');

    fireEvent.click(screen.getByTestId('back-to-neighborhoods'));
    expect(currentParams().get('state')).toBe('MD');
    expect(currentParams().has('city')).toBe(false);
    expect(currentParams().has('groupFrom')).toBe(false);
    await waitFor(() => expect(lastGroupQuery()).toMatchObject({ state: 'MD' }));
    expect(lastGroupQuery()).not.toHaveProperty('city');
  });

  it('comes back correctly from a shared drill-down URL', async () => {
    render(
      <SearchExperience initialQuery="city=Bethesda&state=MD&neighborhood=Chevy+Chase&groupFrom=Bethesda%7CMD" />,
    );
    fireEvent.click(await screen.findByTestId('back-to-neighborhoods'));
    expect(currentParams().get('groupBy')).toBe('neighborhood');
    expect(currentParams().get('city')).toBe('Bethesda');
    expect(currentParams().has('neighborhood')).toBe(false);
  });

  it('drills down from the sale and rent counts with the listing type set', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    const sale = await screen.findAllByRole('link', { name: /for sale in Chevy Chase/ });
    expect(sale[0].getAttribute('href')).toContain('type=sale');
    fireEvent.click(sale[0]);
    expect(currentParams().get('type')).toBe('sale');
    expect(currentParams().get('neighborhood')).toBe('Chevy Chase');
    expect(currentParams().has('groupBy')).toBe(false);
    await waitFor(() =>
      expect(mockedSearch.mock.calls.at(-1)?.[0]).toMatchObject({
        listingType: 'sale',
        neighborhood: 'Chevy Chase',
      }),
    );
  });

  it('moves to the other search path for a count link on a search path', async () => {
    window.history.replaceState(null, '', '/homes-for-sale?q=Bethesda&groupBy=neighborhood');
    render(
      <SearchExperience
        initialQuery="q=Bethesda&groupBy=neighborhood"
        place={{ filters: { listingType: 'sale' }, label: '', query: '' }}
      />,
    );
    const rent = (await screen.findAllByRole('link', { name: /for rent in Chevy Chase/ }))[0];
    const href = rent.getAttribute('href') ?? '';
    expect(href.startsWith('/homes-for-rent?')).toBe(true);
    expect(href).toContain('neighborhood=Chevy+Chase');
    expect(href).not.toContain('type=');
    expect(href).not.toContain('groupBy');
  });

  it('drills down from the rent count with listing type rent', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    fireEvent.click((await screen.findAllByRole('link', { name: /for rent in Kensington/ }))[0]);
    expect(currentParams().get('type')).toBe('rent');
    expect(currentParams().get('neighborhood')).toBe('Kensington');
  });

  it('follows Back and Forward', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    choose('group-by-control', 'Neighborhood');
    await screen.findByTestId('neighborhood-group-grid');

    window.history.replaceState(null, '', '/search?q=Bethesda');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.queryByTestId('neighborhood-group-grid')).toBeNull());

    window.history.replaceState(null, '', '/search?q=Bethesda&groupBy=neighborhood');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByTestId('neighborhood-group-grid')).toBeTruthy();
  });

  it('says no neighborhoods match, not no homes', async () => {
    mockedGroups.mockResolvedValue({ results: [], total: 0 });
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    expect((await screen.findByTestId('neighborhood-group-empty')).textContent).toContain(
      'No neighborhoods match',
    );
  });

  it('shows the error state with a retry', async () => {
    mockedGroups.mockRejectedValueOnce(new Error('boom'));
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('neighborhood-group-grid')).toBeTruthy();
  });

  it('gives the map the page of groups, and no markers outside the grouped view (#503)', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    await waitFor(() => expect(mockMapProps.current).not.toBeNull());
    expect(mockMapProps.current?.neighborhoods).toBeUndefined();

    choose('group-by-control', 'Neighborhood');
    await screen.findByTestId('neighborhood-group-grid');
    await waitFor(() => expect(mockMapProps.current?.neighborhoods?.rows).toHaveLength(2));
    expect(mockMapProps.current?.neighborhoods?.rows.map((r) => r.key)).toEqual([
      'md|bethesda|chevy chase',
      'md|bethesda|kensington',
    ]);
  });

  it('links a card and its marker by key on hover and focus (#503)', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    await screen.findByTestId('neighborhood-group-grid');
    const key = 'md|bethesda|chevy chase';
    const card = () => document.querySelector(`[data-neighborhood-key="${key}"]`) as HTMLElement;

    fireEvent.mouseEnter(card());
    expect(mockMapProps.current?.neighborhoods?.activeKey).toBe(key);
    expect(card().dataset.active).toBe('true');
    fireEvent.mouseLeave(card());
    expect(mockMapProps.current?.neighborhoods?.activeKey).toBeNull();

    // A marker hover reaches the card.
    act(() => mockMapProps.current?.neighborhoods?.onActive('md|bethesda|kensington'));
    expect(
      (document.querySelector('[data-neighborhood-key="md|bethesda|kensington"]') as HTMLElement)
        .dataset.active,
    ).toBe('true');
  });

  it('drills down from a marker like a card, and fits the map to the bounds (#503)', async () => {
    const bounds = { south: 38.9, west: -77.1, north: 39, east: -77 };
    mockedGroups.mockResolvedValue({
      results: [{ ...row('Chevy Chase'), centroid: { lat: 38.95, lng: -77.05 }, bounds }],
      total: 1,
    });
    render(<SearchExperience initialQuery="q=Bethesda&beds=2&groupBy=neighborhood" />);
    await screen.findByTestId('neighborhood-group-grid');
    await waitFor(() => expect(mockMapProps.current?.neighborhoods?.rows).toHaveLength(1));

    act(() =>
      mockMapProps.current?.neighborhoods?.onSelect(mockMapProps.current?.neighborhoods?.rows[0]),
    );

    expect(currentParams().has('groupBy')).toBe(false);
    expect(currentParams().get('neighborhood')).toBe('Chevy Chase');
    expect(currentParams().get('city')).toBe('Bethesda');
    expect(currentParams().get('state')).toBe('MD');
    expect(currentParams().get('beds')).toBe('2');
    expect(currentParams().get('groupFrom')).not.toBeNull();
    expect(mockMapProps.current?.neighborhoods).toBeUndefined();
    expect(mockMapProps.current?.focusBounds).toEqual(bounds);

    fireEvent.click(screen.getByTestId('back-to-neighborhoods'));
    expect(mockMapProps.current?.focusBounds).toBeNull();
  });

  it('pages the groups by offset', async () => {
    mockedGroups.mockResolvedValue({ results: [row('A')], total: 60 });
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=neighborhood" />);
    await screen.findByTestId('neighborhood-group-grid');
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(currentParams().get('page')).toBe('3');
    await waitFor(() => expect(lastGroupQuery()).toMatchObject({ offset: 48 }));
  });
});
