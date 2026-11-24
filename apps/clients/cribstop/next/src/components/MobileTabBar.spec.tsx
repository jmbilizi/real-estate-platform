import { render, screen } from '@testing-library/react';
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

  it('links the three primary tabs to existing routes and has no Saved or Settings tab', () => {
    render(<MobileTabBar />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/services', '/connect']);
    expect(MOBILE_TABS.map((t) => t.label)).toEqual(['Homes', 'Services', 'Connect']);
    const bar = screen.getByTestId('mobile-tab-bar');
    expect(bar.querySelector('button')).toBeNull();
    expect(bar.querySelector('ul')!.className).toContain('grid-cols-3');
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
  ])('marks one tab current on %s', (path, label) => {
    mockPath = path;
    render(<MobileTabBar />);
    const current = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(label);
  });

  it.each(['/account', '/account/favorites'])('marks no tab current on %s', (path) => {
    mockPath = path;
    render(<MobileTabBar />);
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current'))).toHaveLength(
      0,
    );
  });

  it('gives each tab a 44px target', () => {
    render(<MobileTabBar />);
    const targets = screen.getByTestId('mobile-tab-bar').querySelectorAll('a, button');
    expect(targets).toHaveLength(3);
    targets.forEach((el) => expect(el.className).toContain('min-h-11'));
  });

  it.each(['/property/abc', '/listing/123'])('is absent on %s', (path) => {
    mockPath = path;
    render(<MobileTabBar />);
    expect(screen.queryByTestId('mobile-tab-bar')).toBeNull();
    expect(screen.queryByTestId('mobile-tab-bar-spacer')).toBeNull();
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
        /html\[data-overlay-open\] \.mobile-tab-bar[^{]*\{\s*visibility:\s*hidden/,
      );
    });

    it('defines the offset sticky actions use, and zeroes it from md up', () => {
      expect(css).toMatch(/--tab-bar-h:\s*0px/);
      expect(css).toMatch(
        /@media \(max-width: 767px\)\s*\{\s*:root\s*\{\s*--tab-bar-h:\s*calc\(3\.5rem \+ env\(safe-area-inset-bottom/,
      );
    });
  });
});
