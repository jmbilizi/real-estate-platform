import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import NavBar from './NavBar';
import type { User } from '@/lib/store/types';

const mockPush = jest.fn();
jest.mock('nextjs-toploader/app', () => ({
  useRouter: () => ({ push: mockPush }),
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
jest.mock(
  './SlidePanel',
  () =>
    ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? <div data-testid="slide-panel">{children}</div> : null,
);
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
    // Three tab icons, three tab labels, Apps, account, More.
    expect(html.match(/skeleton-fill/g) ?? []).toHaveLength(9);
  });

  /**
   * PRD §6.1: the brokerage name is the most prominent brand on the site, and must read from
   * server-rendered HTML, not only after the bundle hydrates. Both the brokerage name and the
   * CRIB/STOP wordmark are compile-time constants, so there is no hydration uncertainty to
   * placeholder over — unlike the tab labels below, which stay skeletoned because they wait on
   * the route-derived active tab.
   */
  it('ships the brokerage name and wordmark in server-rendered HTML', () => {
    const html = serverHtml();

    expect(html).toContain('Real Broker, LLC');
    expect(html).toContain('CRIB');
    expect(html).toContain('STOP');
  });

  it('still placeholders the tab labels, which are not known until hydration resolves', () => {
    const html = serverHtml();

    for (const copy of ['Homes', 'Services', 'Connect']) {
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

    /**
     * The server-render correctness check, not a client-side effect assertion. `render()` runs
     * `useLayoutEffect`, so it cannot observe the pre-hydration markup — only `serverHtml` (via
     * `renderToStaticMarkup`) can. This is the test that fails against the pre-fix `NavBar`, which
     * derived `isActive` from the store's `activeTab` (server default: 'homes') instead of from
     * the route, and so always underlined Homes in the raw SSR HTML regardless of the URL.
     */
    it.each([
      ['/', 'Homes'],
      ['/services', 'Services'],
      ['/connect', 'Connect'],
    ])('underlines %s -> %s in the server-rendered HTML, not Homes', (path, expectedLabel) => {
      mockPathname.mockReturnValue(path);
      const html = serverHtml();

      const underlineMarker = 'absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand';
      // Exactly one underline renders in the whole tab row.
      expect(html.split(underlineMarker).length - 1).toBe(1);

      // Tab order in the markup follows NAV_TABS (Homes, Services, Connect); splitting on each
      // tab button isolates which one carries the underline and the active ("text-ink", not
      // "text-ink-muted") class, without depending on tab copy, which is still skeletoned.
      const buttons = html.split('<button').slice(1);
      expect(buttons).toHaveLength(3);
      const labels = ['Homes', 'Services', 'Connect'];
      labels.forEach((label, i) => {
        const isExpected = label === expectedLabel;
        expect(buttons[i].includes(underlineMarker)).toBe(isExpected);
        expect(buttons[i].includes('text-ink-muted')).toBe(!isExpected);
      });
    });
  });
});

describe('NavBar after hydration', () => {
  it('resolves to the sign-in control for a signed-out visitor', () => {
    mockUseApp.mockReturnValue(appValue(null));
    const { container } = render(<NavBar />);

    expect(screen.getByRole('button', { name: 'Sign in or sign up' })).toBeInTheDocument();
    expect(container.querySelector('.skeleton-fill')).toBeNull();
  });

  it('resolves to the profile control for a signed-in visitor', () => {
    mockUseApp.mockReturnValue(appValue(A_USER));
    const { container } = render(<NavBar />);

    expect(screen.getByLabelText('Profile menu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in or sign up' })).not.toBeInTheDocument();
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

describe('NavBar right side', () => {
  beforeEach(() => mockPush.mockClear());

  it('gives every icon button a label and a tooltip', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);

    for (const name of ['Saved', 'Sign in or sign up', 'More options']) {
      expect(screen.getByLabelText(name)).toHaveAttribute('title', name);
    }
  });

  it('opens the sign-in modal from the account button when signed out', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in or sign up' }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('modal=login'), {
      scroll: false,
    });
  });

  it('opens the auth modal from the More menu', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign in or sign up' }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('modal=login'), {
      scroll: false,
    });
  });

  it('keeps the profile panel behind the account button when signed in', () => {
    mockUseApp.mockReturnValue(appValue(A_USER));
    render(<NavBar />);

    expect(screen.getByRole('button', { name: 'Profile menu' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });
});

describe('NavBar profile and right-side spacing', () => {
  const MARGIN = /(^|\s)(md:)?-?m[trblxy]?-/;

  it('opens the profile panel from the signed-in account button', () => {
    mockUseApp.mockReturnValue(appValue(A_USER));
    render(<NavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Profile menu' }));

    expect(screen.getByTestId('slide-panel')).toHaveTextContent('Saved homes');
  });

  it('shows the profile photo instead of the initials when the user has one', () => {
    mockUseApp.mockReturnValue(appValue({ ...A_USER, avatar: 'https://example.com/me.jpg' }));
    const { container } = render(<NavBar />);

    expect(container.querySelector('img[src="https://example.com/me.jpg"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Profile menu' })).not.toHaveTextContent('D');
  });

  it('puts every right-side item in one flex row with one gap value', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);
    const row = screen.getByLabelText('Saved').parentElement as HTMLElement;

    expect(row.className).toContain('gap-1.5');
    expect(row.className).toContain('md:gap-2');
    expect(row.children).toHaveLength(4);
    for (const child of Array.from(row.children)) {
      expect(child.className).not.toMatch(MARGIN);
    }
  });

  it('gives the More trigger the mirror margin of the logo, a tight glyph box and no extra gap', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);
    const more = screen.getByLabelText('More options');

    // Only -mr-1, the mirror of the logo's -ml-1. No margin on the left, where the flex gap applies.
    expect(more.className.match(new RegExp(MARGIN.source, 'g'))).toEqual([' -mr-']);
    expect(more.className).toContain('-mr-1');
    expect(more.className).toContain('h-6');
    expect(more.className).toContain('w-1');
    expect(more.querySelector('svg')?.getAttribute('viewBox')).toBe('10.2 3.2 3.6 17.6');
  });

  it('draws the More skeleton in the same box', () => {
    mockUseApp.mockReturnValue(appValue(null));
    const html = renderToStaticMarkup(<NavBar />);

    expect(html).toContain('-mr-1 h-6 w-1 shrink-0');
    expect(html).not.toContain('4.5px');
  });
});
