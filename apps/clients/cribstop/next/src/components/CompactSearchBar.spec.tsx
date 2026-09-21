import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import CompactSearchBar from './CompactSearchBar';

jest.mock('nextjs-toploader/app', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

/** Only the dock wrapper is a `motion.div`; the morph itself is not under test here. */
jest.mock('motion/react', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: Record<string, unknown>) => {
          const React = require('react');
          const { layout: _l, layoutId: _lid, transition: _tr, ...domProps } = rest;
          return React.createElement(tag, domProps, children as React.ReactNode);
        },
    },
  ),
}));

const mockUseApp = jest.fn();
jest.mock('@/lib/context', () => ({ useApp: () => mockUseApp() }));

/* jsdom ships no `matchMedia`; the bar reads it to opt its morph out of reduced motion. */
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
});

function appValue(searchLocation: string) {
  return {
    listingTab: 'buy',
    setListingTab: jest.fn(),
    searchLocation,
    setSearchLocation: jest.fn(),
    searchSuggestion: null,
    setSearchSuggestion: jest.fn(),
    searchMoveInDate: '',
    setSearchMoveInDate: jest.fn(),
    searchDateRange: { start: null, end: null },
    setSearchDateRange: jest.fn(),
    searchBedsIdx: 0,
    setSearchBedsIdx: jest.fn(),
    searchPropertyTypes: [],
    setSearchPropertyTypes: jest.fn(),
    searchBaths: null,
    setSearchBaths: jest.fn(),
    searchMaxPrice: 0,
    setSearchMaxPrice: jest.fn(),
    searchDescription: '',
    setSearchDescription: jest.fn(),
    searchListingType: 'sale',
    setSearchListingType: jest.fn(),
    showHeaderPill: false,
    headerExpanded: false,
    setHeaderExpanded: jest.fn(),
    listingType: 'for-sale',
  };
}

/**
 * The search bar's "Where" value before the client takes over.
 *
 * `renderToStaticMarkup` is the instrument because this window *is* the server's HTML — it sits on
 * screen from first paint until the bundle downloads, parses and runs, which on a cold load is
 * seconds rather than the frame it looks like from inside React.
 */
describe('CompactSearchBar before hydration', () => {
  const serverHtml = (searchLocation = '') => {
    mockUseApp.mockReturnValue(appValue(searchLocation));
    return renderToStaticMarkup(<CompactSearchBar />);
  };

  /*
   * The regression this guards: `searchLocation` is seeded from the URL by an effect in
   * `SearchExperience`, which never runs on the server. So `/search?q=Alexandria, VA` shipped a bar
   * reading "Add locations" — a confident, wrong answer for someone who plainly did search.
   */
  it('shows a placeholder rather than claiming the search is empty', () => {
    const html = serverHtml('');

    expect(html).toContain('skeleton-fill');
    expect(html).not.toContain('Add locations');
  });

  /** The store having a value changes nothing: the server still cannot know it is the right one. */
  it('shows the placeholder even when the store already carries a location', () => {
    const html = serverHtml('Alexandria, VA');

    expect(html).toContain('skeleton-fill');
    expect(html).not.toContain('Alexandria, VA');
  });

  /** Same token as every listing placeholder, so the header and the cards sweep as one system. */
  it('paints the placeholder with the shared skeleton token', () => {
    expect(serverHtml()).toContain('bg-surface-soft skeleton-fill');
  });

  /** Labels as well as values — the whole bar reads as one loading surface, not a half-drawn one. */
  it('places a skeleton in every field label and value', () => {
    const html = serverHtml();

    for (const copy of ['Where', 'When', 'What', 'Anywhere', 'Add dates', 'For Sale']) {
      expect(html).not.toContain(copy);
    }
    // Three labels, three values, and the search button.
    expect(html.match(/skeleton-fill/g) ?? []).toHaveLength(7);
  });

  /**
   * The submit control is part of the bar's shape, not chrome around it — a solid coral circle
   * sitting in a row of placeholders is the one thing that would still read as half-loaded.
   */
  it('places a skeleton in the search button', () => {
    const html = serverHtml();

    expect(html).toContain('h-12 w-12 rounded-full');
    // The real button is present but hidden, so its slot keeps the width `searchBtnRef` measures.
    expect(html).not.toContain('bg-brand text-white shadow-sm transition hover:bg-brand-700 flex');
  });

  /**
   * The swap itself must not read as a flicker. Snapping grey→text looks worse the faster the
   * connection: the placeholder registers as a blink, then is gone in one frame.
   */
  it('fades the resolved content in rather than snapping to it', () => {
    mockUseApp.mockReturnValue(appValue('Alexandria, VA'));
    const { container } = render(<CompactSearchBar />);

    expect(container.querySelector('.skeleton-fill')).toBeNull();
    expect(container.querySelectorAll('.content-resolved').length).toBeGreaterThan(0);
  });
});
