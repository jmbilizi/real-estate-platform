import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import NavBar from './NavBar';
import type { User } from '@/lib/store/types';

jest.mock('nextjs-toploader/app', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

/* The global setup pins `usePathname` to '/'; the tab tests need to move it. */
const mockPathname = jest.fn(() => '/');
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

/** Only `motion.span` is used, for the active-tab underline. */
jest.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: Record<string, unknown>) => {
          const React = require('react');
          // Framer-only props would be invalid DOM attributes; drop them.
          const { layoutId: _l, transition: _tr, ...domProps } = rest;
          return React.createElement(tag, domProps, children as React.ReactNode);
        },
    },
  ),
}));

/* Children with their own dependency trees — this file is about the nav's own slots. */
jest.mock('./AppsDropdown', () => () => <div data-testid="apps-dropdown" />);
jest.mock('./MobileSearchSheet', () => () => <div data-testid="mobile-search-sheet" />);
jest.mock('./MobileSearchPill', () => () => <div data-testid="mobile-search-pill" />);
jest.mock('./SlidePanel', () => ({ children }: { children: React.ReactNode }) => (
  <div>{children}</div>
));
jest.mock('./DismissButton', () => () => <button type="button">Dismiss</button>);

const mockUseApp = jest.fn();
jest.mock('@/lib/context', () => ({ useApp: () => mockUseApp() }));

const A_USER: User = { email: 'dana@example.com' } as User;

function appValue(user: User | null) {
  return {
    user,
    logout: jest.fn(),
    activeTab: 'homes',
    setActiveTab: jest.fn(),
    showHeaderPill: false,
    headerExpanded: false,
    setHeaderExpanded: jest.fn(),
    mobileSearchOpen: false,
    setMobileSearchOpen: jest.fn(),
  };
}

beforeEach(() => {
  mockUseApp.mockReturnValue(appValue(null));
  mockPathname.mockReturnValue('/');
});

/**
 * What a visitor sees before the bundle hydrates.
 *
 * `renderToStaticMarkup` is the honest instrument for this: the pre-hydration window is not a
 * React state we can hold still in jsdom — `useLayoutEffect` has already run by the time
 * `render()` returns — it is literally the server's HTML, sitting on screen from first paint
 * until the bundle arrives, parses and runs. On a cold load that is seconds.
 */
describe('NavBar before hydration', () => {
  const serverHtml = (user: User | null = null) => {
    mockUseApp.mockReturnValue(appValue(user));
    return renderToStaticMarkup(<NavBar />);
  };

  /*
   * The regression this guards: the entire right-hand nav was a single empty `h-8 w-[100px]` box
   * until the bundle ran. Every control now keeps its own slot and draws a placeholder in it, so
   * the header has its real shape from first paint.
   */
  it('keeps every control in its own slot', () => {
    const html = serverHtml();

    expect(html).toContain('aria-label="Saved"');
    // Logo, three tab icons, three tab labels, Saved, Apps, account.
    expect(html.match(/skeleton-fill/g) ?? []).toHaveLength(11);
  });

  it('draws the logo, the tabs and the nav controls as placeholders', () => {
    const html = serverHtml();

    // No real copy has been committed to anywhere in the header.
    for (const copy of ['CRIB', 'STOP', 'Homes', 'Services', 'Connect']) {
      expect(html).not.toContain(copy);
    }
  });

  /**
   * `auth` is the only slice restored from localStorage, so the server cannot know the answer.
   * Guessing one would be a hydration mismatch for whichever visitor got the other.
   */
  it('commits to neither answer while the session is unknown', () => {
    const html = serverHtml(A_USER);

    expect(html).not.toContain('Sign in');
    expect(html).not.toContain('dana@example.com');
  });

  /**
   * The header must sweep with the same token as the listing cards, not a second loading
   * vocabulary for the chrome. `FILL` in `listing/ListingStates.tsx` is the same pairing.
   */
  it('paints the placeholder with the shared skeleton token', () => {
    const html = serverHtml();

    expect(html).toContain('bg-surface-soft skeleton-fill');
  });

  /**
   * The other flavour of pre-hydration gap, and the one a placeholder cannot fix: markup that is
   * not blank but confidently wrong. `activeTab` starts at the store default and only learned the
   * route from an effect, so `/services` shipped with the underline under Homes and it jumped
   * across the header on hydration. The route is known server-side, so the tab is now derived
   * from it during render.
   */
  describe('active tab', () => {
    it.each([
      ['/', 'homes'],
      ['/services', 'services'],
      ['/connect', 'connect'],
      ['/services/plumbing', 'services'],
    ])('derives the active tab from %s', (path, expected) => {
      const value = appValue(null);
      mockUseApp.mockReturnValue(value);
      mockPathname.mockReturnValue(path);

      render(<NavBar />);

      expect(value.setActiveTab).toHaveBeenCalledWith(expected);
    });
  });
});

describe('NavBar after hydration', () => {
  it('resolves to the sign-in control for a signed-out visitor', () => {
    mockUseApp.mockReturnValue(appValue(null));
    const { container } = render(<NavBar />);

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(container.querySelector('.skeleton-fill')).toBeNull();
  });

  it('resolves to the profile control for a signed-in visitor', () => {
    mockUseApp.mockReturnValue(appValue(A_USER));
    const { container } = render(<NavBar />);

    expect(screen.getByLabelText('Profile menu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(container.querySelector('.skeleton-fill')).toBeNull();
  });

  /** Saved and Apps are unconditional — they must survive both branches of the swap. */
  it.each([
    ['signed out', null],
    ['signed in', A_USER],
  ])('keeps Saved and Apps for a %s visitor', (_label, user) => {
    mockUseApp.mockReturnValue(appValue(user as User | null));
    render(<NavBar />);

    expect(screen.getByLabelText('Saved')).toBeInTheDocument();
    expect(screen.getByTestId('apps-dropdown')).toBeInTheDocument();
  });
});
