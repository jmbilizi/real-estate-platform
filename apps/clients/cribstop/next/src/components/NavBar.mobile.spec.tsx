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
jest.mock('./AppsDropdown', () => () => <div data-testid="apps-dropdown" />);
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

/** The phone top bar (#943). jsdom has no CSS, so order is read from the `order-*` classes. */
describe('NavBar on a phone (#943)', () => {
  beforeEach(() => mockUseApp.mockReturnValue(appValue(false)));

  const orderOf = (el: Element): number => {
    const m = el.className.match(/(?:^|\s)(?:max-md:)?order-(\d+)/);
    return m ? Number(m[1]) : 0;
  };

  it('lays out apps, search pill and account on one row, in that order', () => {
    render(<NavBar />);
    const apps = screen.getByTestId('apps-dropdown').parentElement as HTMLElement;
    const pill = screen.getByTestId('mobile-search-pill').parentElement as HTMLElement;
    const account = screen.getByRole('button', { name: 'Sign in or sign up' })
      .parentElement as HTMLElement;

    // Apps and Account sit in a `display: contents` wrapper, so they join the pill's flex row.
    expect(apps.parentElement?.className).toContain('max-md:contents');
    expect(apps.parentElement?.parentElement).toBe(pill.parentElement);
    expect(pill.parentElement?.className).toMatch(/(^|\s)flex(\s|$)/);
    expect([apps, pill, account].sort((a, b) => orderOf(a) - orderOf(b))).toEqual([
      apps,
      pill,
      account,
    ]);
    expect(pill.className).toContain('md:hidden');
  });

  it('drops the 3-dot menu and Saved below md, because Settings and the tab bar carry them', () => {
    render(<NavBar />);
    expect(screen.getByRole('button', { name: 'More options' }).className).toContain(
      'max-md:hidden',
    );
    expect(screen.getByRole('link', { name: 'Saved' }).className).toContain('max-md:hidden');
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
