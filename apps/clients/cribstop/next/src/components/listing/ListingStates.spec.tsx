import { render, screen } from '@testing-library/react';
import { aLandParcelRow, aListingCardRow, aSuppressedAddressRow } from '@/test/fixtures';
import { ListingDetailSkeleton } from './ListingStates';

/**
 * The detail skeleton, and the preview it becomes when the open started from a card.
 *
 * The preview exists because a listing opened from a results page is opened from a row that is
 * already in hand — so the beat before the detail fetch lands can show the listing itself instead of
 * grey blocks. The risk it introduces is the one these cases guard: a card row is a *card* row, and
 * anything detail-only must stay absent rather than be invented or rendered as an empty string.
 */
describe('ListingDetailSkeleton', () => {
  describe('without a row, every region is a placeholder', () => {
    it('renders no listing text at all', () => {
      render(<ListingDetailSkeleton />);

      expect(screen.getByRole('status', { name: /loading listing/i })).toBeInTheDocument();
      expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
  });

  describe('with a row, the panel opens on the listing', () => {
    it('shows the address, the dwelling line and the price from the row', () => {
      render(<ListingDetailSkeleton preview={aListingCardRow()} />);

      expect(screen.getByText('100 Test St, Bethesda, MD 20814')).toBeInTheDocument();
      expect(screen.getByText(/3 bd/)).toBeInTheDocument();
      expect(screen.getByText(/\$/)).toBeInTheDocument();
    });

    it('shows the row photo, which is how the user knows it opened on the home they clicked', () => {
      render(<ListingDetailSkeleton preview={aListingCardRow()} />);

      // Two: the below-`md` single image and the mosaic's large cell. Exactly one is ever visible;
      // which one is a media query, which jsdom does not evaluate.
      expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    });

    /**
     * A disclosure label is owed on every surface its row appears on. A panel showing that row's
     * address, photo and price is unambiguously such a surface, even for the second it is up.
     */
    it('carries the sample and sponsored labels rather than deferring them to the loaded page', () => {
      render(
        <ListingDetailSkeleton preview={aListingCardRow({ isSample: true, sponsored: true })} />,
      );

      expect(screen.getByText(/sample/i)).toBeInTheDocument();
      expect(screen.getByText(/sponsored/i)).toBeInTheDocument();
    });

    it('states a withheld price as withheld — never blank, never $0', () => {
      render(<ListingDetailSkeleton preview={aListingCardRow({ price: null })} />);

      expect(screen.getByText(/withheld/i)).toBeInTheDocument();
      expect(screen.queryByText(/\$0\b/)).not.toBeInTheDocument();
    });

    it('shows no street line for a suppressed address, and no centroid standing in for one', () => {
      render(<ListingDetailSkeleton preview={aSuppressedAddressRow()} />);

      expect(screen.queryByText(/\d+ .*(St|Ave|Rd|Ln)\b/)).not.toBeInTheDocument();
      // Falls back to the same location heading the loaded page uses, never to `title`.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/\w/);
    });

    it('omits the dwelling triplet for a parcel instead of rendering zeroes', () => {
      render(<ListingDetailSkeleton preview={aLandParcelRow()} />);

      expect(screen.queryByText(/\bbd\b/)).not.toBeInTheDocument();
      expect(screen.queryByText(/NaN|undefined|null/)).not.toBeInTheDocument();
    });

    /**
     * The preview must not leak detail-only content. Description, open houses and full attribution
     * are absent from a card row, so they stay skeletal — rendering them as empty strings would
     * assert that the listing has none.
     */
    it('leaves the detail-only regions skeletal', () => {
      const { container } = render(<ListingDetailSkeleton preview={aListingCardRow()} />);

      expect(container.querySelectorAll('.bg-surface-soft').length).toBeGreaterThan(0);
    });
  });

  /**
   * The gallery placeholder's shape.
   *
   * The preview's first version put the primary photo in one full-width block, which is the shape
   * the loaded gallery has only when a listing has **no** photos. With any media the desktop gallery
   * is a 4x2 mosaic, so the panel opened on one big photo and then snapped into five tiles — the
   * exact "does not reflect the gallery's look" the user reported.
   *
   * jsdom evaluates no media queries, so these assert the structure that produces the right shape;
   * the pixel equality behind it was measured in a browser (preview and loaded both 1206x482 at
   * desktop with 295px columns and 236px rows, and both 332x187 at 390px wide).
   */
  describe('the gallery placeholder mirrors PropertyGallery, not a single image', () => {
    const gallery = (c: HTMLElement) => c.querySelector('[class*="grid-cols-4"]');

    it('lays the desktop placeholder out as the mosaic the loaded gallery uses', () => {
      const { container } = render(<ListingDetailSkeleton preview={aListingCardRow()} />);

      const grid = gallery(container);
      expect(grid).not.toBeNull();
      expect(grid?.className).toContain('md:grid-rows-2');
      expect(grid?.className).toContain('md:h-[480px]');
      // The primary photo spans the mosaic's large cell rather than the whole block.
      expect(grid?.querySelector('.col-span-2.row-span-2')).not.toBeNull();
    });

    /**
     * Four, and it is not a guess about photo count: `PropertyGallery` pads to five tiles by
     * repeating (`i % media.length`), so every listing with at least one photo renders five.
     */
    it('holds four tile placeholders for the photos still in flight', () => {
      const { container } = render(<ListingDetailSkeleton preview={aListingCardRow()} />);

      expect(container.querySelectorAll('[data-gallery-tile-placeholder]')).toHaveLength(4);
    });

    it('keeps the gallery in the same bordered panel the loaded page wraps it in', () => {
      const withPreview = render(<ListingDetailSkeleton preview={aListingCardRow()} />);
      const bare = render(<ListingDetailSkeleton />);
      const wrapper = (c: HTMLElement) =>
        c.querySelector('.scrollbar-overlay')?.firstElementChild?.className;

      // Identical wrappers is what makes the block measure the same in both states.
      expect(wrapper(withPreview.container)).toBe(wrapper(bare.container));
      expect(wrapper(withPreview.container)).toContain('border-surface-border');
    });

    /**
     * A row with no primary photo is the one case where the loaded gallery is genuinely a single
     * block, so the mosaic must not be drawn — four tiles would be promising photos that never come.
     */
    it('drops the mosaic for a row with no photo, rather than promising tiles that never arrive', () => {
      const { container } = render(
        <ListingDetailSkeleton preview={aListingCardRow({ primaryMedia: null })} />,
      );

      expect(gallery(container)).toBeNull();
      expect(container.querySelectorAll('[data-gallery-tile-placeholder]')).toHaveLength(0);
    });

    it('draws no mosaic at all when there is no row', () => {
      const { container } = render(<ListingDetailSkeleton />);

      expect(gallery(container)).toBeNull();
      expect(container.querySelectorAll('[data-gallery-tile-placeholder]')).toHaveLength(0);
    });
  });

  /**
   * Every section of the loaded page needs a counterpart here, or that section arrives with no
   * warning and shoves everything below it down the page.
   *
   * The list is the loaded page's own section stack, read off `ListingDetailContent`. Measured at
   * the time these were added: the skeleton's body was 946px against a loaded 2220px, so more than
   * half the page appeared with nothing holding its place — and the map panel alone is ~500px of
   * that. Afterwards the two measured 2215px and 2220px, with every section's top offset equal.
   */
  describe('section coverage', () => {
    const SECTIONS = [
      'gallery',
      'price',
      'stats',
      'description',
      'amenities',
      'map',
      'disclosure',
      'agent',
      'mortgage',
      'similar-homes',
    ];

    it.each(SECTIONS)('reserves the %s section', (section) => {
      const { container } = render(<ListingDetailSkeleton preview={aListingCardRow()} />);

      expect(container.querySelector(`[data-skeleton-section="${section}"]`)).not.toBeNull();
    });

    it('reserves every section on a hard load too, where there is no row at all', () => {
      const { container } = render(<ListingDetailSkeleton />);

      const found = [...container.querySelectorAll('[data-skeleton-section]')].map((el) =>
        el.getAttribute('data-skeleton-section'),
      );
      expect(found).toEqual(SECTIONS);
    });

    /**
     * The loaded page renders the mortgage estimate only for a sale with a price. With a row in hand
     * that is knowable, so reserving it for a rental would be reserving space for a panel that never
     * comes.
     */
    it('drops the mortgage panel for a rental, which will not render one', () => {
      const { container } = render(
        <ListingDetailSkeleton preview={aListingCardRow({ listingType: 'rent' })} />,
      );

      expect(container.querySelector('[data-skeleton-section="mortgage"]')).toBeNull();
    });

    it('drops it for a withheld price too, for the same reason', () => {
      const { container } = render(
        <ListingDetailSkeleton preview={aListingCardRow({ price: null })} />,
      );

      expect(container.querySelector('[data-skeleton-section="mortgage"]')).toBeNull();
    });
  });

  /**
   * One fill for placeholders, and the distinction that makes the rule meaningful.
   *
   * A **container** legitimately carries the loaded page's own surface — the detail panels are white
   * cards, the canvas is `surface-alt`, the mortgage panel is brand-tinted — because the skeleton
   * has to reproduce the loaded layout. A **placeholder**, meaning a leaf standing in for content,
   * must always be the one fill. The regression this guards was exactly that confusion: the stats,
   * agent and mortgage stand-ins were bare white panels with nothing inside them, which read as
   * empty panels rather than as content arriving.
   */
  describe('placeholder fill', () => {
    const leaves = (container: HTMLElement) =>
      [...container.querySelectorAll('div, span')].filter((el) => el.children.length === 0);

    it.each([
      ['with a row', aListingCardRow()],
      ['without a row', undefined],
    ])('paints no placeholder white (%s)', (_label, preview) => {
      const { container } = render(<ListingDetailSkeleton preview={preview} />);

      const whiteLeaves = leaves(container).filter(
        (el) => el.className.includes('bg-white') && el.textContent?.trim() === '',
      );

      expect(whiteLeaves.map((el) => el.className)).toEqual([]);
    });

    it('uses the one fill for the placeholders it does draw', () => {
      const { container } = render(<ListingDetailSkeleton />);

      const filled = leaves(container).filter((el) => el.className.includes('bg-surface-soft'));

      // Sanity: the rule above is only meaningful if placeholders are actually being drawn.
      expect(filled.length).toBeGreaterThan(10);
    });
  });
});
