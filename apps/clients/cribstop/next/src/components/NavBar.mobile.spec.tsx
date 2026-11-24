import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import NavBar from './NavBar';

jest.mock('nextjs-toploader/app', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children }: { children?: React.ReactNode }) => {
          const React = require('react');
          return React.createElement(tag, null, children);
        },
    },
  ),
}));
jest.mock('./MobileSearchSheet', () => () => <div data-testid="mobile-search-sheet" />);
jest.mock('./MobileSearchPill', () => () => <div data-testid="mobile-search-pill" />);
jest.mock(
  './SlidePanel',
  () =>
    ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? <div>{children}</div> : null,
);
jest.mock('./DismissButton', () => () => <button type="button">Dismiss</button>);

const mockUseApp = jest.fn();
jest.mock('@/lib/context', () => ({ useApp: () => mockUseApp() }));

function appValue(showHeaderPill: boolean) {
  return {
    user: null,
    logout: jest.fn(),
    activeTab: 'homes',
    setActiveTab: jest.fn(),
    showHeaderPill,
    headerExpanded: false,
    setHeaderExpanded: jest.fn(),
    mobileSearchOpen: false,
    setMobileSearchOpen: jest.fn(),
  };
}

/** The phone top bar (#943). jsdom has no CSS, so order is read from the DOM order. */
describe('NavBar on a phone (#943)', () => {
  beforeEach(() => mockUseApp.mockReturnValue(appValue(false)));

  it('lays out the search pill and account on one row, in that order, with no Apps grid', () => {
    render(<NavBar />);
    const pill = screen.getByTestId('mobile-search-pill').parentElement as HTMLElement;
    const account = screen.getByRole('button', { name: 'Sign in or sign up' });
    const row = pill.parentElement as HTMLElement;

    expect(row.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(row.contains(account)).toBe(true);
    // The pill comes first in the row and takes the free width.
    expect(pill.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pill.className).toContain('flex-1');
    expect(pill.className).toContain('md:hidden');
    expect(screen.queryByTestId('apps-dropdown')).toBeNull();
    expect(row.innerHTML).not.toMatch(/[\s":]order-\d/);
  });

  it('keeps the brand mark and hides the pill slot and the tabs below md, where the tab bar has the tabs', () => {
    render(<NavBar />);
    const mark = screen.getByRole('link', { name: /Cribstop at Real Broker, LLC/ });
    expect(mark.querySelector('svg[data-brand-mark="cs"]')).not.toBeNull();
    expect(mark.className).not.toMatch(/hidden/);
    const tabs = screen.getByRole('navigation', { name: 'Primary', hidden: true });
    expect(tabs.className).toContain('hidden');
    expect(tabs.className).toContain('md:flex');
    expect(document.querySelector('.header-pill-slot')?.className).toContain('max-md:hidden');
  });

  it('keeps the 3-dot menu beside Account on a phone and has no Saved button', () => {
    render(<NavBar />);
    const more = screen.getByRole('button', { name: 'More options' });
    expect(more.className).not.toContain('max-md:hidden');
    expect(more.className).toContain('max-md:before:-inset-x-2.5');
    expect(screen.queryByRole('link', { name: 'Saved' })).toBeNull();
  });

  it('gives every phone control a 44px target', () => {
    const { container } = render(<NavBar />);
    expect(container.innerHTML).not.toContain('max-md:h-10');
    expect(screen.getByRole('button', { name: 'Sign in or sign up' }).className).toContain('h-11');
  });

  it('renders the same markup whether or not the page is scrolled', () => {
    mockUseApp.mockReturnValue(appValue(false));
    const atTop = renderToStaticMarkup(<NavBar />);
    mockUseApp.mockReturnValue(appValue(true));
    const scrolled = renderToStaticMarkup(<NavBar />);
    expect(scrolled).toBe(atTop);
    expect(scrolled).toContain('data-testid="mobile-search-pill"');
  });
});
