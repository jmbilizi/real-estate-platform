import { act, fireEvent, render, screen } from '@testing-library/react';
import CompactSearchBar from './CompactSearchBar';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

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

const frederick = {
  lat: '39.4143',
  lon: '-77.4105',
  display_name: 'Frederick, Frederick County, Maryland, United States',
  type: 'city',
  address: { city: 'Frederick', state: 'Maryland', country_code: 'us' },
};

jest.mock('@/lib/context', () => ({
  useApp: () => ({
    listingTab: 'buy',
    setListingTab: jest.fn(),
    searchLocation: 'Frederick, MD',
    setSearchLocation: jest.fn(),
    searchSuggestion: frederick,
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
  }),
}));

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

// The bar stays mounted across navigation. A search must not leave the button spinning.
it('re-enables the search button once the navigation it started has rendered', async () => {
  render(<CompactSearchBar />);
  const searchButtons = () => screen.getAllByRole('button', { name: 'Search' });
  expect(searchButtons()).toHaveLength(1);

  await act(async () => {
    fireEvent.click(searchButtons()[0]);
  });

  expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/search?'));
  expect(searchButtons()[0]).not.toBeDisabled();
});
