import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  getBrokerGroups,
  getNeighborhoodGroups,
  getZipGroups,
  searchListings,
} from '@/lib/api/listings';
import SearchExperience from './SearchExperience';

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
const mockedBrokers = getBrokerGroups as jest.Mock;
const mockedNeighborhoods = getNeighborhoodGroups as jest.Mock;

const BROKERS = {
  groups: [
    { key: '1001', name: 'Acme Realty', count: 9 },
    { key: '3001', name: 'Real Broker, LLC', count: 5 },
    { key: 'unlisted', name: 'Other / unlisted', count: 2 },
  ],
  total: 3,
  listingTotal: 16,
};

const openGroupOptions = () => {
  fireEvent.click(screen.getByTestId('group-by-control'));
  return screen.queryAllByRole('option').map((option) => option.textContent);
};
const currentParams = () => new URLSearchParams(window.location.search);
const lastBrokerQuery = () => mockedBrokers.mock.calls.at(-1)?.[0] as Record<string, unknown>;

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
  mockedZips.mockResolvedValue({ groups: [], total: 1, listingTotal: 0 });
  mockedBrokers.mockResolvedValue(BROKERS);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
  window.history.replaceState(null, '', '/search?q=Bethesda');
});

afterEach(() => {
  mockPush.mockReset();
  mockedSearch.mockReset();
  mockedZips.mockReset();
  mockedBrokers.mockReset();
  mockedNeighborhoods.mockReset();
});

describe('Group by broker (#722)', () => {
  it('always lists the Broker option, even on a single-ZIP search', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    await waitFor(() => expect(mockedZips).toHaveBeenCalled());

    expect(openGroupOptions()).toEqual(['None', 'Neighborhood', 'Broker']);
  });

  it('never groups by broker by default, and reads an unknown groupBy as no grouping', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=office" />);
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled());

    expect(mockedBrokers).not.toHaveBeenCalled();
    expect(screen.queryByTestId('broker-group-grid')).toBeNull();
    expect(currentParams().get('groupBy')).toBeNull();
  });

  it('shows one card per office in the order given, every card in the same style', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&beds=2" />);
    fireEvent.click(screen.getByTestId('group-by-control'));
    fireEvent.click(screen.getByRole('option', { name: 'Broker' }));

    expect(await screen.findByTestId('broker-group-grid')).toBeTruthy();
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-group-key]'));
    expect(cards.map((card) => card.dataset.groupKey)).toEqual(['1001', '3001', 'unlisted']);
    expect(screen.getByText('Other / unlisted')).toBeTruthy();
    expect(screen.getByText('Brokers')).toBeTruthy();
    // No card is pinned, highlighted or styled apart from another, Real Broker, LLC included.
    expect(new Set(cards.map((card) => card.className)).size).toBe(1);
    expect(currentParams().get('groupBy')).toBe('broker');
    expect(lastBrokerQuery()).toMatchObject({ beds: 2, limit: 24, offset: 0, order: 'count' });
  });

  it('sends order=name for the name order', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=broker" />);
    await screen.findByTestId('broker-group-grid');

    fireEvent.click(screen.getByTestId('group-order-control'));
    fireEvent.click(screen.getByRole('option', { name: 'Name A-Z' }));
    await waitFor(() => expect(lastBrokerQuery()).toMatchObject({ order: 'name' }));
    expect(currentParams().get('groupOrder')).toBe('name');
  });

  it('opens an office with a removable chip, and removing it returns to the broker groups', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=broker" />);
    fireEvent.click(await screen.findByRole('link', { name: 'Broker Acme Realty, 9 homes' }));

    await waitFor(() => expect(currentParams().get('officeKey')).toBe('1001'));
    expect(currentParams().get('groupBy')).toBeNull();
    expect(currentParams().get('groupDrill')).toBe('broker');
    expect(currentParams().get('groupLabel')).toBe('Acme Realty');
    const chip = await screen.findByTestId('clear-group-drill');
    expect(chip.textContent).toBe('Acme Realty');

    fireEvent.click(chip);
    await waitFor(() => expect(currentParams().get('groupBy')).toBe('broker'));
    expect(currentParams().get('officeKey')).toBeNull();
    expect(currentParams().get('groupLabel')).toBeNull();
    expect(await screen.findByTestId('broker-group-grid')).toBeTruthy();
  });

  it('always shows a chip for an officeKey filter, and removing it just clears the filter', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&officeKey=1234567" />);
    const chip = await screen.findByTestId('clear-group-drill');
    expect(chip.textContent).toBe('Broker');

    fireEvent.click(chip);
    await waitFor(() => expect(currentParams().get('officeKey')).toBeNull());
    expect(currentParams().get('groupBy')).toBeNull();
    expect(mockedBrokers).not.toHaveBeenCalled();
    expect(screen.queryByTestId('clear-group-drill')).toBeNull();
  });

  it('opens the unlisted group with the `unlisted` key', async () => {
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=broker" />);
    fireEvent.click(await screen.findByRole('link', { name: 'Broker Other / unlisted, 2 homes' }));

    await waitFor(() => expect(currentParams().get('officeKey')).toBe('unlisted'));
  });

  it('has no brokerage picker in the filter bar', async () => {
    render(<SearchExperience initialQuery="q=Bethesda" />);
    fireEvent.click(screen.getByLabelText('Open filters'));

    expect(screen.queryByText(/broker/i)).toBeNull();
  });

  it('shows the loading skeleton, then the empty state', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockedBrokers.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<SearchExperience initialQuery="q=Bethesda&groupBy=broker" />);
    expect(await screen.findByTestId('broker-group-skeleton')).toBeTruthy();

    resolve({ groups: [], total: 0, listingTotal: 0 });
    expect(await screen.findByTestId('broker-group-empty')).toBeTruthy();
  });
});
