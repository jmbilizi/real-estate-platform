/**
 * #556. The expanded map had no way back, and it hid the header's and results bar's stacking
 * problem behind the same fix.
 */
const container = document.createElement('div');
const invalidateSize = jest.fn();
jest.mock('react-leaflet', () => ({
  useMap: () => ({
    getContainer: () => container,
    invalidateSize,
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
  }),
}));

import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CustomMapControls } from './CustomMapControls';
import { MAP_EXPANDED_ATTRIBUTE } from '@/lib/useMapExpand';

const htmlExpanded = () => document.documentElement.hasAttribute(MAP_EXPANDED_ATTRIBUTE);

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('CustomMapControls expand and exit', () => {
  let pushState: jest.SpyInstance;
  let back: jest.SpyInstance;

  beforeEach(() => {
    pushState = jest.spyOn(window.history, 'pushState');
    back = jest.spyOn(window.history, 'back').mockImplementation(() => undefined);
    invalidateSize.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    container.className = '';
  });

  it('shows no exit control until the map is expanded', () => {
    render(<CustomMapControls />);

    expect(screen.queryByRole('button', { name: 'Exit full screen map' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Full screen map' })).toBeTruthy();
  });

  it('swaps the expand control for a 44px exit control in the same slot', () => {
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));

    const exit = screen.getByRole('button', { name: 'Exit full screen map' });
    expect(exit.style.width).toBe('44px');
    expect(exit.style.height).toBe('44px');
    expect(screen.queryByRole('button', { name: 'Full screen map' })).toBeNull();
    expect(container.classList.contains('fullscreen-map')).toBe(true);
    expect(htmlExpanded()).toBe(true);
    expect(invalidateSize).toHaveBeenCalled();
  });

  it('restores the layout when the exit control is pressed', () => {
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen map' }));

    expect(container.classList.contains('fullscreen-map')).toBe(false);
    expect(htmlExpanded()).toBe(false);
    expect(screen.getByRole('button', { name: 'Full screen map' })).toBeTruthy();
  });

  it('restores the layout on Escape', () => {
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(container.classList.contains('fullscreen-map')).toBe(false);
    expect(htmlExpanded()).toBe(false);
  });

  it('leaves Escape to an open dialog', () => {
    render(
      <>
        <CustomMapControls />
        <div role="dialog" aria-modal="true" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(htmlExpanded()).toBe(true);
  });

  it('does not pop a history entry that something else pushed after expand', () => {
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    window.history.pushState({ panel: true }, '', window.location.href);
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen map' }));

    expect(back).not.toHaveBeenCalled();
    expect(htmlExpanded()).toBe(false);
  });

  it('ignores Escape while the map is not expanded', () => {
    render(<CustomMapControls />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(back).not.toHaveBeenCalled();
    expect(htmlExpanded()).toBe(false);
  });

  it('pushes one history entry on expand and pops it again on exit', () => {
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    expect(pushState).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen map' }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('exits on Back and does not pop a second entry', () => {
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(htmlExpanded()).toBe(false);
    expect(container.classList.contains('fullscreen-map')).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('claims no Back step when the history push fails', () => {
    pushState.mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    expect(htmlExpanded()).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(htmlExpanded()).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('clears the page state when the map unmounts while expanded', () => {
    const { unmount } = render(<CustomMapControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    unmount();

    expect(htmlExpanded()).toBe(false);
    expect(container.classList.contains('fullscreen-map')).toBe(false);
  });

  it.each([360, 640, 768, 1024, 1280, 1600, 1024, 768, 640, 360])(
    'keeps the expanded state across a resize to %ipx',
    (width) => {
      render(<CustomMapControls />);
      fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
      setWidth(width);

      expect(htmlExpanded()).toBe(true);
      expect(container.classList.contains('fullscreen-map')).toBe(true);
      expect(screen.getByRole('button', { name: 'Exit full screen map' })).toBeTruthy();
    },
  );
});

/**
 * jsdom has no layout engine, so these read the rules the browser applies. The real positions are
 * measured in a browser, per the ticket.
 */
describe('search layout stays attached to the header (#556)', () => {
  const read = (...parts: string[]) =>
    fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

  it('raises the map column above the header, the docked search bar and the results bar', () => {
    const css = read('app', 'globals.css');

    expect(css).toMatch(
      /html\[data-map-expanded\] \.search-map-column\s*\{\s*z-index:\s*theme\('zIndex\.map-expanded'\)/,
    );
    expect(css).toMatch(/html\[data-map-expanded\]\s*\{[^}]*overflow:\s*hidden/);
  });

  it('marks the map column so the rule above reaches it', () => {
    expect(read('components', 'SearchExperience.tsx')).toMatch(/className="search-map-column /);
  });

  it('keeps the header sticky in its own layer, not tied to a viewport width', () => {
    const header = read('components', 'SiteHeader.tsx');

    expect(header).toContain('sticky top-0 z-chrome');
    expect(header).not.toMatch(/\b(?:sm|md|lg|xl):(?:sticky|fixed|absolute)/);
  });

  it('keeps the results bar sticky inside its column, not fixed to the viewport', () => {
    const bar = read('components', 'SearchExperience.tsx').match(
      /className="search-results-bar ([^"]*)"/,
    );

    expect(bar?.[1]).toContain('sticky top-[65px]');
    expect(bar?.[1]).not.toMatch(/\bfixed\b/);
  });
});
