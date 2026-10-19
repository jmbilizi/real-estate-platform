import { render, screen } from '@testing-library/react';
import CompactSearchBar from './CompactSearchBar';
import MobileTabBar from './MobileTabBar';
import { OVERLAY_OPEN_ATTRIBUTE } from '@/lib/overlay';
import { Z_LAYERS } from '@/lib/z-layers';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}));

jest.mock('@/lib/context', () => ({
  useApp: () => ({
    user: null,
    listingTab: 'buy',
    setListingTab: jest.fn(),
    searchLocation: '',
    setSearchLocation: jest.fn(),
    searchSuggestion: null,
    setSearchSuggestion: jest.fn(),
    searchListingType: 'sale',
    setSearchListingType: jest.fn(),
    showHeaderPill: false,
    headerExpanded: false,
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
  window.scrollTo = jest.fn();
});

describe('mobile search sheet (#953)', () => {
  it('is a modal dialog that registers as an overlay, so the tab bar hides', () => {
    const { unmount } = render(
      <>
        <MobileTabBar />
        <CompactSearchBar mobileSheetMode onClose={jest.fn()} />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Search homes' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.documentElement).toHaveAttribute(OVERLAY_OPEN_ATTRIBUTE);
    expect(screen.getByTestId('mobile-tab-bar').className).toContain('mobile-tab-bar');
    unmount();
    expect(document.documentElement).not.toHaveAttribute(OVERLAY_OPEN_ATTRIBUTE);
  });

  it('keeps the Search button clear of the home-indicator inset and above the tab bar', () => {
    render(<CompactSearchBar mobileSheetMode onClose={jest.fn()} />);
    const button = screen.getByRole('button', { name: /search homes/i });
    expect(button.parentElement?.className).toContain('env(safe-area-inset-bottom)');
    expect(Z_LAYERS.searchOverlay).toBeGreaterThan(Z_LAYERS.chrome);
  });
});
