import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import MobileSearchPill from './MobileSearchPill';

const mockPathname = jest.fn(() => '/');
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

const mockUseApp = jest.fn();
jest.mock('@/lib/context', () => ({ useApp: () => mockUseApp() }));

function appValue(searchLocation = '') {
  return {
    searchLocation,
    listingType: 'sale',
    activeTab: 'homes',
    searchDateRange: { start: null, end: null },
    setMobileSearchOpen: jest.fn(),
  };
}

beforeEach(() => {
  mockUseApp.mockReturnValue(appValue());
  mockPathname.mockReturnValue('/');
});

describe('MobileSearchPill before hydration', () => {
  /*
   * Regression: `searchLocation` only seeds asynchronously on `/search` (via `SearchExperience`).
   * Everywhere else the store's default ('') is already the settled answer server-side, so
   * placeholdering it there swaps a one-line button for a two-line skeleton on hydration — a
   * height change this ticket was written to eliminate, not introduce.
   */
  it('skips the placeholder off the /search route, where there is nothing async to wait on', () => {
    mockPathname.mockReturnValue('/');
    const html = renderToStaticMarkup(<MobileSearchPill />);

    expect(html).not.toContain('skeleton-fill');
    expect(html).toContain('Start your search');
  });

  it('placeholders on /search, where searchLocation is seeded from the URL after mount', () => {
    mockPathname.mockReturnValue('/search');
    const html = renderToStaticMarkup(<MobileSearchPill />);

    expect(html).toContain('skeleton-fill');
    expect(html).not.toContain('Start your search');
  });
});

describe('MobileSearchPill after hydration', () => {
  it('renders the search button when no location is set', () => {
    mockUseApp.mockReturnValue(appValue(''));
    const { getByText } = render(<MobileSearchPill />);

    expect(getByText('Start your search')).toBeInTheDocument();
  });

  it('renders the location pill once a location is set', () => {
    mockUseApp.mockReturnValue(appValue('Alexandria, VA'));
    const { getByText } = render(<MobileSearchPill />);

    expect(getByText('Alexandria, VA')).toBeInTheDocument();
  });
});
