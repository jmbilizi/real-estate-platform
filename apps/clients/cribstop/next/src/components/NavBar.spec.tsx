import { fireEvent, render, screen } from '@testing-library/react';
import { BRAND } from '@/lib/brand';
import { readdirSync } from 'fs';
import { join } from 'path';
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

    expect(html).not.toContain('aria-label="Saved"');
    // Only the account label is unknown. The account icon, the More dots and the tabs are real
    // from first paint.
    expect(html.match(/skeleton-fill/g) ?? []).toHaveLength(1);
  });

  /**
   * The header brand is the "cs" mark (stakeholder decision 2026-11-24). Its link name holds the
   * site name and the brokerage name, and both read from server-rendered HTML, not only after the
   * bundle hydrates. They are compile-time constants, so there is no hydration uncertainty.
   */
  it('ships the brand mark, with both names in its link name, in server-rendered HTML', () => {
    const html = serverHtml();

    expect(html).toContain(`aria-label="${BRAND.siteName} at ${BRAND.brokerage}: home"`);
    expect(html).toContain('data-brand-mark="cs"');
    expect(html).not.toContain('>at<');
  });

  /** The tabs are fixed copy and real links, so they are in the server HTML and work with no JS. */
  it('ships the three primary tabs as links in server-rendered HTML', () => {
    const html = serverHtml();
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));

    for (const [label, href] of [
      ['Homes', '/'],
      ['Services', '/services'],
      ['Connect', '/connect'],
    ]) {
      expect(nav).toContain(`href="${href}"`);
      expect(nav).toContain(`aria-label="${label}"`);
      expect(nav).toContain(`>${label}</span>`);
    }
    expect(nav).not.toContain('skeleton-fill');
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

      const underlineMarker = 'absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-brand';
      // Exactly one underline renders in the whole tab row.
      expect(html.split(underlineMarker).length - 1).toBe(1);

      // Tab order in the markup follows PRIMARY_TABS (Homes, Services, Connect). Splitting the
      // nav on each tab link isolates which one carries the underline and the active
      // ("text-ink", not "text-ink-muted") class.
      const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
      const buttons = nav.split('<a ').slice(1);
      expect(buttons).toHaveLength(3);
      const labels = ['Homes', 'Services', 'Connect'];
      labels.forEach((label, i) => {
        const isExpected = label === expectedLabel;
        expect(buttons[i].includes(underlineMarker)).toBe(isExpected);
        expect(buttons[i].includes('text-ink-muted')).toBe(!isExpected);
        expect(buttons[i].includes('aria-current="page"')).toBe(isExpected);
      });
    });

    /** On an account page the account control is the active item, and no tab is. */
    it.each(['/account', '/favorites'])(
      'marks Account active on %s in the server-rendered HTML, and no tab',
      (path) => {
        mockPathname.mockReturnValue(path);
        const html = serverHtml();

        const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
        expect(nav).not.toContain('aria-current="page"');
        expect(nav).not.toContain('rounded-full bg-brand');
        expect(html).toContain('data-testid="account-active-underline"');
      },
    );

    it('does not mark Account active on a tab page', () => {
      mockPathname.mockReturnValue('/services');

      expect(serverHtml()).not.toContain('data-testid="account-active-underline"');
    });
  });
});

describe('NavBar account item', () => {
  it.each([
    ['signed out', null, 'Sign in or sign up'],
    ['signed in', A_USER, 'Profile menu'],
  ])('is the current item on /account when %s', (_case, user, name) => {
    mockUseApp.mockReturnValue(appValue(user));
    mockPathname.mockReturnValue('/account');
    render(<NavBar />);

    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Homes' })).not.toHaveAttribute('aria-current');
  });

  it('moves the active state to a tab at the click, before the route changes', () => {
    mockPathname.mockReturnValue('/account');
    render(<NavBar />);

    fireEvent.click(screen.getByRole('link', { name: 'Homes' }));

    expect(screen.getByRole('link', { name: 'Homes' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('account-active-underline')).not.toBeInTheDocument();
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

  /** The tabs are unconditional: they must survive both branches of the swap. The row has no
   *  Saved button: a signed-in user gets "Saved homes" in the account panel. */
  it.each([
    ['signed out', null],
    ['signed in', A_USER],
  ])('keeps the three tabs and shows no Saved button for a %s visitor', (_label, user) => {
    mockUseApp.mockReturnValue(appValue(user as User | null));
    render(<NavBar />);

    expect(screen.queryByLabelText('Saved')).toBeNull();
    for (const name of ['Homes', 'Services', 'Connect']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });
});

describe('NavBar right side', () => {
  let pushState: jest.SpyInstance;
  beforeEach(() => {
    mockPush.mockClear();
    pushState = jest.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
  });
  afterEach(() => pushState.mockRestore());

  it('gives every icon button a label and a tooltip', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);

    for (const name of ['Sign in or sign up', 'More options']) {
      expect(screen.getByLabelText(name)).toHaveAttribute('title', name);
    }
  });

  it('opens the sign-in modal from the account button when signed out', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in or sign up' }));

    expect(pushState).toHaveBeenCalledWith(null, '', expect.stringContaining('modal=login'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the auth modal from the More menu', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign in or sign up' }));

    expect(pushState).toHaveBeenCalledWith(null, '', expect.stringContaining('modal=login'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps the profile panel behind the account button when signed in', () => {
    mockUseApp.mockReturnValue(appValue(A_USER));
    render(<NavBar />);

    expect(screen.getByRole('button', { name: 'Profile menu' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
  });

  it('links every profile panel entry to a route that exists', () => {
    mockUseApp.mockReturnValue(appValue(A_USER));
    render(<NavBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Profile menu' }));

    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/') && h !== '/');
    expect(hrefs).toEqual(expect.arrayContaining(['/account', '/favorites']));

    const routes = pageRoutes(join(__dirname, '..', 'app'));
    for (const href of hrefs) {
      expect({ href, found: routes.some((r) => routeMatches(r, href)) }).toEqual({
        href,
        found: true,
      });
    }
  });
});

/** Route segments of every page.tsx under the app dir. Route groups and slots add no segment. */
function pageRoutes(dir: string, parts: string[] = []): string[][] {
  const out: string[][] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const hidden = /^\(.*\)$/.test(e.name) || e.name.startsWith('@');
      out.push(...pageRoutes(join(dir, e.name), hidden ? parts : [...parts, e.name]));
    } else if (e.name === 'page.tsx') {
      out.push(parts);
    }
  }
  return out;
}

function routeMatches(route: string[], href: string): boolean {
  const segs = href.split(/[?#]/)[0].split('/').filter(Boolean);
  for (let i = 0; i < route.length; i++) {
    const r = route[i];
    if (r.startsWith('[...')) return segs.length > i;
    if (segs[i] === undefined) return false;
    if (!r.startsWith('[') && r !== segs[i]) return false;
  }
  return route.length === segs.length;
}

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
    // The photo replaces the account icon. The first name stays beside it.
    expect(screen.getByRole('button', { name: 'Profile menu' }).querySelector('svg')).toBeNull();
  });

  it('shows the account icon then "Sign in" when signed out', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);
    const button = screen.getByRole('button', { name: 'Sign in or sign up' });

    expect(button.querySelector('svg')).not.toBeNull();
    expect(button).toHaveTextContent('Sign in');
    // The label follows the tab labels: hidden below lg.
    expect(button.querySelector('span')!.className).toMatch(/(^|\s)hidden\s.*lg:inline/);
  });

  it('shows the account icon then the first name when signed in, and still opens the panel', () => {
    mockUseApp.mockReturnValue(appValue({ ...A_USER, firstName: 'Dana', lastName: 'Okafor' }));
    render(<NavBar />);
    const button = screen.getByRole('button', { name: 'Profile menu' });

    expect(button.querySelector('svg')).not.toBeNull();
    expect(button).toHaveTextContent(/^Dana$/);
    fireEvent.click(button);
    expect(screen.getByTestId('slide-panel')).toHaveTextContent('Saved homes');
  });

  it('puts every right-side item in one flex row with one gap value', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);
    const row = screen
      .getByRole('button', { name: 'More options' })
      .closest('.z-20') as HTMLElement;

    expect(row.className).toContain('gap-1.5');
    expect(row.className).toContain('md:gap-2');
    // Account, More. There is no Saved button and no Apps grid.
    expect(row.children).toHaveLength(2);
    for (const child of Array.from(row.children)) {
      expect(child.className).not.toMatch(MARGIN);
    }
  });

  it('gives the More trigger the mirror margin of the logo, a tight glyph box and no extra gap', () => {
    mockUseApp.mockReturnValue(appValue(null));
    render(<NavBar />);
    const more = screen.getByLabelText('More options');

    // From md: a 4px glyph box with -mr-1. On a phone: a 24px box with a 44px hit area.
    expect(more.className).toContain('md:-mr-1');
    expect(more.className).toContain('h-6');
    expect(more.className).toContain('md:w-1');
    expect(more.className).toContain('max-md:before:-inset-x-2.5');
    expect(more.className).not.toContain('max-md:hidden');
    expect(more.querySelector('svg')?.getAttribute('viewBox')).toBe('10.2 3.2 3.6 17.6');
  });

  it('draws the real More dots before hydration, in the same box', () => {
    mockUseApp.mockReturnValue(appValue(null));
    const html = renderToStaticMarkup(<NavBar />);

    expect(html).toContain('viewBox="10.2 3.2 3.6 17.6"');
    expect(html).toContain('h-6 w-6 shrink-0');
    expect(html).not.toContain('4.5px');
  });
});
