import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MobileTabBar, { MOBILE_TABS } from './MobileTabBar';
import { Z_LAYERS } from '@/lib/z-layers';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('@/lib/context', () => ({ useApp: () => ({ user: null }) }));

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

describe('MobileTabBar (#923, #943)', () => {
  beforeEach(() => {
    mockPath = '/';
  });

  it('links four tabs to existing routes and ends with a Settings button', () => {
    render(<MobileTabBar />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/services', '/connect', '/favorites']);
    expect(MOBILE_TABS.map((t) => t.label)).toEqual([
      'Homes',
      'Services',
      'Connect',
      'Saved',
      'Settings',
    ]);
    expect(screen.queryByRole('link', { name: /account/i })).toBeNull();
    const last = screen.getByTestId('mobile-tab-bar').querySelector('li:last-child') as HTMLElement;
    expect(last).toHaveTextContent('Settings');
    expect(last.querySelector('button')).not.toBeNull();
  });

  it('is phone only and clears the home indicator', () => {
    render(<MobileTabBar />);
    const nav = screen.getByTestId('mobile-tab-bar');
    expect(nav.className).toContain('md:hidden');
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(screen.getByTestId('mobile-tab-bar-spacer').className).toContain('md:hidden');
  });

  it('reserves the bar height plus the safe-area inset at the end of the page', () => {
    render(<MobileTabBar />);
    const style = screen.getByTestId('mobile-tab-bar-spacer').getAttribute('style');
    expect(style).toContain('3.5rem');
    expect(style).toContain('safe-area-inset-bottom');
  });

  it.each([
    ['/', 'Homes'],
    ['/search', 'Homes'],
    ['/services', 'Services'],
    ['/connect', 'Connect'],
    ['/favorites', 'Saved'],
  ])('marks one tab current on %s', (path, label) => {
    mockPath = path;
    render(<MobileTabBar />);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it('marks no tab current on /account, which now lives in the top bar', () => {
    mockPath = '/account';
    render(<MobileTabBar />);
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current'))).toHaveLength(
      0,
    );
  });

  it('gives each tab a 44px target', () => {
    render(<MobileTabBar />);
    const targets = screen.getByTestId('mobile-tab-bar').querySelectorAll('a, button');
    expect(targets).toHaveLength(5);
    targets.forEach((el) => expect(el.className).toContain('min-h-11'));
  });

  it.each(['/property/abc', '/listing/123'])('is absent on %s', (path) => {
    mockPath = path;
    render(<MobileTabBar />);
    expect(screen.queryByTestId('mobile-tab-bar')).toBeNull();
    expect(screen.queryByTestId('mobile-tab-bar-spacer')).toBeNull();
  });

  it('opens the former 3-dot menu items from Settings, as a bottom sheet', () => {
    render(<MobileTabBar />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.className).toContain('rounded-t-2xl');
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Sign in or sign up',
      'Help',
      'About',
      'Fair Housing',
      'Accessibility',
      'Privacy Policy',
      'Terms of Service',
    ]);
  });

  it('closes the sheet when an item is chosen', async () => {
    render(<MobileTabBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  describe('never blocks content', () => {
    it('sits below every dialog layer', () => {
      render(<MobileTabBar />);
      expect(Z_LAYERS.chrome).toBeLessThan(Z_LAYERS.dialog);
      expect(screen.getByTestId('mobile-tab-bar').className).toContain('z-chrome');
    });

    it('hides while a dialog is open', () => {
      render(<MobileTabBar />);
      expect(screen.getByTestId('mobile-tab-bar').className).toContain('mobile-tab-bar');
      expect(css).toMatch(
        /html:has\(\[data-scroll-lock\]\) \.mobile-tab-bar\s*\{\s*visibility:\s*hidden/,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(document.querySelector('[data-scroll-lock]')).not.toBeNull();
    });

    it('defines the offset sticky actions use, and zeroes it from md up', () => {
      expect(css).toMatch(/--tab-bar-h:\s*0px/);
      expect(css).toMatch(
        /@media \(max-width: 767px\)\s*\{\s*:root\s*\{\s*--tab-bar-h:\s*calc\(3\.5rem \+ env\(safe-area-inset-bottom/,
      );
    });
  });
});
