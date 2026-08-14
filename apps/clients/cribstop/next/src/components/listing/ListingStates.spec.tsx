import { render, screen } from '@testing-library/react';
import { aLandParcelRow, aListingCardRow, aSuppressedAddressRow } from '@/test/fixtures';
import { ListingDetailSkeleton } from './ListingStates';

/**
 * The detail skeleton: a uniformly skeletal loading state, however the panel was opened.
 *
 * An earlier version drew the clicked card's real address, price and primary photo during the
 * loading beat, on the reasoning that a card click already has them. Product decided against it —
 * half-real and half-grey reads as a broken render rather than as a page arriving. These cases pin
 * the decision, because the row is still passed in (`layoutRow`) and the temptation to draw from it
 * is exactly what they exist to catch.
 */
describe('ListingDetailSkeleton', () => {
  describe('draws no listing data, whichever way the panel was opened', () => {
    it.each([
      ['without a row', undefined],
      ['with a row in hand', aListingCardRow()],
      ['with a suppressed-address row', aSuppressedAddressRow()],
      ['with a parcel row', aLandParcelRow()],
    ])('renders no text and no photo from the listing (%s)', (_label, layoutRow) => {
      const { container } = render(<ListingDetailSkeleton layoutRow={layoutRow} />);

      expect(screen.getByRole('status', { name: /loading listing/i })).toBeInTheDocument();
      // The row's own values, none of which may reach the DOM.
      expect(container.textContent).not.toMatch(/Test St|Bethesda|MD|bd\b|sqft/);
      expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    /**
     * The heading keeps its `h1` and its type classes — the placeholder lives *inside* them — because
     * that is what makes the header measure the same before and after the data lands. Sized by hand
     * it stood 73px against the loaded 81px and shifted everything below it by 8px.
     */
    it('keeps the real heading element, with a placeholder inside it rather than text', () => {
      render(<ListingDetailSkeleton layoutRow={aListingCardRow()} />);

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading.className).toContain('text-base');
      expect(heading.textContent?.trim()).toBe('');
    });

    /**
     * The disclosure rule is "labelled on every surface a sample row appears on" and "wherever it
     * renders". This surface renders no part of the row, so there is nothing being disclosed about —
     * a label here would be labelling a blank panel. It attaches the instant the row does, in
     * `ListingDetailContent`. What would be a violation is the reverse, and it cannot happen now:
     * showing the row's address and price here without the labels.
     */
    it('carries no disclosure label, because it shows no row to disclose about', () => {
      render(
        <ListingDetailSkeleton layoutRow={aListingCardRow({ isSample: true, sponsored: true })} />,
      );

      expect(screen.queryByText(/sample/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sponsored/i)).not.toBeInTheDocument();
    });
  });

  /**
   * The gallery placeholder's shape.
   *
   * An early version was one full-width block, which is the shape the loaded gallery has only when a
   * listing has **no** photos. With any media the desktop gallery is a 4x2 mosaic, so the panel
   * opened on one big block and then snapped into five tiles.
   *
   * jsdom evaluates no media queries, so these assert the structure that produces the right shape;
   * the pixel equality behind it was measured in a browser — skeleton and loaded both 1206x482 at
   * desktop with 295px columns, 236px rows and an 8px gap, and both 332x187 at 390px wide.
   */
  describe('the gallery placeholder mirrors PropertyGallery, not a single image', () => {
    const gallery = (c: HTMLElement) => c.querySelector('[class*="grid-cols-4"]');

    it.each([
      ['with a row', aListingCardRow()],
      ['without one', undefined],
    ])('lays the desktop placeholder out as the loaded mosaic (%s)', (_label, layoutRow) => {
      const { container } = render(<ListingDetailSkeleton layoutRow={layoutRow} />);

      const grid = gallery(container);
      expect(grid).not.toBeNull();
      expect(grid?.className).toContain('md:grid-rows-2');
      expect(grid?.className).toContain('md:h-[480px]');
      // The large cell is a placeholder like the rest, spanning 2x2 as the primary photo will.
      expect(grid?.querySelector('.col-span-2.row-span-2')).not.toBeNull();
    });

    /**
     * Five, and not a guess about photo count: `PropertyGallery` pads to five tiles by repeating
     * (`i % media.length`), so every listing with at least one photo renders five.
     */
    it('holds five tile placeholders — the large cell and the four beside it', () => {
      const { container } = render(<ListingDetailSkeleton layoutRow={aListingCardRow()} />);

      expect(container.querySelectorAll('[data-gallery-tile-placeholder]')).toHaveLength(5);
    });

    it('keeps the gallery in the same bordered panel the loaded page wraps it in', () => {
      const withRow = render(<ListingDetailSkeleton layoutRow={aListingCardRow()} />);
      const bare = render(<ListingDetailSkeleton />);
      const wrapper = (c: HTMLElement) =>
        c.querySelector('.scrollbar-overlay')?.firstElementChild?.className;

      // Identical wrappers is what makes the block measure the same in both states.
      expect(wrapper(withRow.container)).toBe(wrapper(bare.container));
      expect(wrapper(withRow.container)).toContain('border-surface-border');
    });

    /**
     * The one case only `layoutRow` can know, and the reason it is still consulted: a listing with
     * no media loads a single branded block, so drawing the mosaic would promise five photos that
     * never arrive.
     */
    it('drops the mosaic for a row with no photo, rather than promising tiles that never come', () => {
      const { container } = render(
        <ListingDetailSkeleton layoutRow={aListingCardRow({ primaryMedia: null })} />,
      );

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
      const { container } = render(<ListingDetailSkeleton layoutRow={aListingCardRow()} />);

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
        <ListingDetailSkeleton layoutRow={aListingCardRow({ listingType: 'rent' })} />,
      );

      expect(container.querySelector('[data-skeleton-section="mortgage"]')).toBeNull();
    });

    it('drops it for a withheld price too, for the same reason', () => {
      const { container } = render(
        <ListingDetailSkeleton layoutRow={aListingCardRow({ price: null })} />,
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
    ])('paints no placeholder white (%s)', (_label, layoutRow) => {
      const { container } = render(<ListingDetailSkeleton layoutRow={layoutRow} />);

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
