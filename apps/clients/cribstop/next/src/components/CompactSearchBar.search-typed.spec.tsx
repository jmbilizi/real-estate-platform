import { act, fireEvent, render, screen } from '@testing-library/react';
import CompactSearchBar from './CompactSearchBar';

/**
 * #369: clicking Search with typed text that was never picked from the dropdown used to do
 * nothing — the "never an unfiltered search" guard (#339/#350) refused any pick that was not a
 * committed suggestion object, even a real street or address the user plainly typed. The fix
 * geocodes the typed text with the same call the dropdown uses and routes its top result exactly
 * like a pick.
 */

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/homes-for-sale',
}));

jest.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: Record<string, unknown>) => {
          const React = require('react');
          const { layout: _l, layoutId: _lid, transition: _tr, ...domProps } = rest;
          return React.createElement(tag, domProps, children as React.ReactNode);
        },
    },
  ),
}));

function appValue(searchLocation: string) {
  return {
    listingTab: 'buy',
    setListingTab: jest.fn(),
    searchLocation,
    setSearchLocation: jest.fn(),
    // No committed suggestion — the typed text was never picked from the dropdown (the bug).
    searchSuggestion: null,
    setSearchSuggestion: jest.fn(),
    searchMoveInDate: '',
    setSearchMoveInDate: jest.fn(),
    searchDateRange: { start: null, end: null },
    setSearchDateRange: jest.fn(),
    searchListingType: 'sale',
    setSearchListingType: jest.fn(),
    showHeaderPill: false,
    headerExpanded: true,
    setHeaderExpanded: jest.fn(),
    listingType: 'for-sale',
  };
}

jest.mock('@/lib/context', () => ({ useApp: () => mockUseApp() }));
const mockUseApp = jest.fn();

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
      onchange: null,
    }),
  });
});

beforeEach(() => {
  mockPush.mockClear();
});

function mockGeocodeResults(results: unknown[]) {
  global.fetch = jest.fn((url: string) => {
    if (String(url).startsWith('/api/geocode?q=')) {
      return Promise.resolve({ ok: true, json: async () => results } as Response);
    }
    return Promise.resolve({ ok: false, json: async () => [] } as Response);
  }) as unknown as typeof fetch;
}

async function clickSearch() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  });
}

it('searches a typed address by geocoding it and routing to the property page', async () => {
  mockUseApp.mockReturnValue(appValue('123 Main St, Frederick, MD'));
  mockGeocodeResults([
    {
      lat: '39.4143',
      lon: '-77.4105',
      display_name: '123 Main St, Frederick, MD, United States',
      type: 'house',
      addresstype: 'house',
      address: { house_number: '123', road: 'Main St', city: 'Frederick', state_code: 'MD' },
    },
  ]);
  render(<CompactSearchBar />);

  await clickSearch();

  expect(mockPush).toHaveBeenCalledWith('/frederick-md/123-main-st-frederick-md');
});

it('searches a typed street by geocoding it and routing to the street search path', async () => {
  mockUseApp.mockReturnValue(appValue('Main St, Frederick, MD'));
  mockGeocodeResults([
    {
      lat: '39.4143',
      lon: '-77.4105',
      display_name: 'Main St, Frederick, MD, United States',
      type: 'road',
      addresstype: 'road',
      address: { road: 'Main St', city: 'Frederick', state_code: 'MD' },
    },
  ]);
  render(<CompactSearchBar />);

  await clickSearch();

  expect(mockPush).toHaveBeenCalledWith('/frederick-md/main-st/homes-for-sale');
});

it('searches a typed city by geocoding it and routing to the city search path', async () => {
  mockUseApp.mockReturnValue(appValue('Frederick, MD'));
  mockGeocodeResults([
    {
      lat: '39.4143',
      lon: '-77.4105',
      display_name: 'Frederick, Frederick County, Maryland, United States',
      name: 'Frederick',
      type: 'city',
      addresstype: 'city',
      address: { city: 'Frederick', state_code: 'MD' },
    },
  ]);
  render(<CompactSearchBar />);

  await clickSearch();

  expect(mockPush).toHaveBeenCalledWith('/frederick-md/homes-for-sale');
});

it('refuses the search and shows an inline message when the geocoder finds nothing', async () => {
  mockUseApp.mockReturnValue(appValue('asdkjfhaslkdjfh'));
  mockGeocodeResults([]);
  render(<CompactSearchBar />);

  await clickSearch();

  expect(mockPush).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not find that location/i);
});
