import { render, screen } from '@testing-library/react';
import MobileTabBar, { MOBILE_TABS } from './MobileTabBar';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

describe('MobileTabBar (#923)', () => {
  beforeEach(() => {
    mockPath = '/';
  });

  it('links five tabs to existing routes', () => {
    render(<MobileTabBar />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/services', '/connect', '/favorites', '/account']);
    expect(MOBILE_TABS).toHaveLength(5);
  });

  it('is phone only and clears the home indicator', () => {
    render(<MobileTabBar />);
    const nav = screen.getByTestId('mobile-tab-bar');
    expect(nav.className).toContain('md:hidden');
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(screen.getByTestId('mobile-tab-bar-spacer').className).toContain('md:hidden');
  });

  it.each([
    ['/', 'Homes'],
    ['/search', 'Homes'],
    ['/services', 'Services'],
    ['/connect', 'Connect'],
    ['/favorites', 'Saved'],
    ['/account', 'Account'],
  ])('marks one tab current on %s', (path, label) => {
    mockPath = path;
    render(<MobileTabBar />);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it('gives each tab a 44px target', () => {
    render(<MobileTabBar />);
    screen.getAllByRole('link').forEach((a) => expect(a.className).toContain('min-h-11'));
  });

  it.each(['/property/abc', '/listing/123'])('is absent on %s', (path) => {
    mockPath = path;
    render(<MobileTabBar />);
    expect(screen.queryByTestId('mobile-tab-bar')).toBeNull();
    expect(screen.queryByTestId('mobile-tab-bar-spacer')).toBeNull();
  });
});
