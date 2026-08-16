import { fireEvent, render, screen } from '@testing-library/react';
import { aLandParcelRow, aListingCardRow, aSuppressedAddressRow } from '@/test/fixtures';
import ListingCard from './ListingCard';
import { getListingPanel, resetListingPanel } from '@/lib/listing-panel';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));

describe('ListingCard', () => {
  describe('nullable fields are guarded at every render site', () => {
    it('renders a land parcel with its lot size instead of the dwelling triplet, and does not throw', () => {
      // The shipped "Lot/Land" chip had zero mock rows behind it, so the first real parcel would
      // also have been the first test — in production, via `sqft.toLocaleString()` on null.
      expect(() => render(<ListingCard listing={aLandParcelRow()} />)).not.toThrow();

      expect(screen.getByText('2.4 acres lot')).toBeInTheDocument();
      expect(screen.queryByText(/\bbd\b/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\bba\b/)).not.toBeInTheDocument();
    });

    it('omits only the missing parts of the triplet rather than rendering a zero or a dash', () => {
      render(<ListingCard listing={aListingCardRow({ baths: null, sqft: null })} />);

      expect(screen.getByText('3 bd')).toBeInTheDocument();
      expect(screen.queryByText(/NaN|undefined|null/)).not.toBeInTheDocument();
    });

    it('falls back to city, state when the neighbourhood is unknown — never a bare comma', () => {
      render(<ListingCard listing={aListingCardRow({ neighborhood: null })} />);

      expect(screen.getByText('Bethesda, MD')).toBeInTheDocument();
      expect(screen.queryByText(/^,|,\s*$/)).not.toBeInTheDocument();
    });

    it('renders a branded placeholder instead of a broken img when there is no photo', () => {
      render(<ListingCard listing={aListingCardRow({ primaryMedia: null })} />);

      expect(screen.getByRole('img', { name: /no photo available/i })).toBeInTheDocument();
      expect(document.querySelector('img')).toBeNull();
    });

    it('renders the media altText, not the listing title, as the image alt', () => {
      render(
        <ListingCard
          listing={aListingCardRow({
            title: 'Stunning Luxury Retreat (Sample)',
            primaryMedia: { url: 'https://example.com/a.jpg', altText: 'Front elevation' },
          })}
        />,
      );

      const img = screen.getByAltText('Front elevation');
      expect(img).toBeInTheDocument();
      expect(img.getAttribute('alt')).not.toContain('Luxury');
    });

    it('renders a suppressed-address row without an address', () => {
      render(<ListingCard listing={aSuppressedAddressRow()} />);
      expect(screen.queryByText(/100 Test St/)).not.toBeInTheDocument();
    });
  });

  describe('price', () => {
    it('renders the withheld sentence for a null price — never blank, never $0, never an estimate', () => {
      render(<ListingCard listing={aListingCardRow({ price: null })} />);

      expect(screen.getByText(/Price withheld at the seller/i)).toBeInTheDocument();
      expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
    });

    it('does not append /month to a withheld rent price', () => {
      render(<ListingCard listing={aListingCardRow({ price: null, listingType: 'rent' })} />);
      expect(screen.queryByText('/month')).not.toBeInTheDocument();
    });
  });

  describe('sold inventory', () => {
    it('renders the close price with its close date rather than the ask', () => {
      render(
        <ListingCard
          listing={aListingCardRow({
            listingType: 'sold',
            status: 'Sold',
            price: 800000,
            closePrice: 765000,
            closeDate: '2026-02-10',
          })}
        />,
      );

      expect(screen.getByText(/Sold for \$765,000 on Feb 10, 2026/)).toBeInTheDocument();
      expect(screen.queryByText('$800,000')).not.toBeInTheDocument();
    });

    it('is visually distinguished from live inventory', () => {
      render(<ListingCard listing={aListingCardRow({ listingType: 'sold', status: 'Sold' })} />);
      expect(screen.getByText('Sold')).toBeInTheDocument();
    });
  });

  describe('required disclosure labels', () => {
    it('labels a sample row', () => {
      render(<ListingCard listing={aListingCardRow({ isSample: true })} />);
      expect(screen.getByText(/sample data/i)).toBeInTheDocument();
    });

    it('does not label a non-sample row', () => {
      render(<ListingCard listing={aListingCardRow({ isSample: false })} />);
      expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
    });

    it('labels a sponsored row, so paid placement is never shown as organic ranking', () => {
      render(<ListingCard listing={aListingCardRow({ sponsored: true })} />);
      expect(screen.getByText('Sponsored')).toBeInTheDocument();
    });

    it('shows both required labels at once, and neither displaces a marketing badge slot', () => {
      render(
        <ListingCard
          listing={aListingCardRow({ isSample: true, sponsored: true, priceReduced: true })}
        />,
      );

      expect(screen.getByText(/sample data/i)).toBeInTheDocument();
      expect(screen.getByText('Sponsored')).toBeInTheDocument();
      expect(screen.getByText('Price reduced')).toBeInTheDocument();
    });
  });

  describe('NAR 7.58 attribution — applies to search results, not only detail pages', () => {
    /**
     * 7.58 governs **IDX displays** — other participants' listings from an MLS feed. A brokerage
     * displaying its own inventory is not making an IDX display, so density follows the row's
     * `source`. This is the regression that would otherwise ship silently the moment #33 lands.
     */
    it('renders the full block for a brightMLS row: agent name, a contact method and the office', () => {
      render(
        <ListingCard
          listing={aListingCardRow({
            source: 'brightMLS',
            listedBy: 'Jane Q. Agent – Bright Partner Realty',
            listingAgentName: 'Jane Q. Agent',
            officeName: 'Bright Partner Realty',
            brokerPhone: '(301) 555-0199',
            brokerEmail: 'jane.agent@example.com',
          })}
        />,
      );

      expect(screen.getByText('Jane Q. Agent – Bright Partner Realty')).toBeInTheDocument();
      expect(screen.getByText('(301) 555-0199')).toBeInTheDocument();
      expect(screen.getByText('jane.agent@example.com')).toBeInTheDocument();
      expect(screen.getByText(/Bright Partner Realty/)).toBeInTheDocument();
    });

    it('names the listing firm separately for an IDX row whose listedBy omits it', () => {
      render(
        <ListingCard
          listing={aListingCardRow({
            source: 'brightMLS',
            listedBy: 'Jane Agent',
            officeName: 'Bright Partner Realty',
          })}
        />,
      );

      expect(screen.getByText('Jane Agent')).toBeInTheDocument();
      // "Listing courtesy of", not the reduced branch's "Listing by": the full block is the IDX
      // display, where the conventional phrasing is what Bright's display rules are most likely to
      // prescribe, so it is not ours to reword ahead of #33. See `ListingAttribution`'s header.
      expect(screen.getByText(/Listing courtesy of Bright Partner Realty/)).toBeInTheDocument();
    });

    it('reduces to the office attribution for our own inventory, where 7.58 does not attach', () => {
      render(<ListingCard listing={aListingCardRow({ source: 'internal' })} />);

      expect(screen.getByText(/Listing by Real Broker, LLC/)).toBeInTheDocument();
      // No contact block — the IDX contact requirement does not apply to a non-IDX display.
      expect(screen.queryByText('(301) 555-0101')).not.toBeInTheDocument();
      expect(screen.queryByText('sample.agent1@example.com')).not.toBeInTheDocument();
    });

    it('keeps a long office name on one line so the tile cannot outgrow its neighbours', () => {
      const officeName = 'Long & Foster Real Estate, Inc. — Bethesda Gateway';
      render(<ListingCard listing={aListingCardRow({ source: 'internal', officeName })} />);

      const line = screen.getByText(/Listing by Long & Foster/);
      expect(line).toHaveClass('truncate');
      // Clipped visually, never lost: `truncate` is CSS only, so the full name stays in the DOM
      // for screen readers, and `title` surfaces it on hover.
      expect(line).toHaveAttribute('title', officeName);
    });

    it('reduces an `other` row the same way', () => {
      render(<ListingCard listing={aListingCardRow({ source: 'other' })} />);

      expect(screen.getByText(/Listing by Real Broker, LLC/)).toBeInTheDocument();
      expect(screen.queryByText('(301) 555-0101')).not.toBeInTheDocument();
    });

    it('renders listedBy as delivered rather than reassembling it from parts', () => {
      render(
        <ListingCard
          listing={aListingCardRow({
            source: 'brightMLS',
            listedBy: 'Jane Q. Agent – Real Broker, LLC',
          })}
        />,
      );
      expect(screen.getByText('Jane Q. Agent – Real Broker, LLC')).toBeInTheDocument();
    });

    it('keeps an IDX row at or above the median type size used for the listing data', () => {
      // Listing data on the card renders at 14px (location), 12px (stats) and 14px (price), so the
      // median is 14px — `text-sm`. Anything smaller fails 7.58's typeface floor, which is why the
      // floor is asserted on the branch 7.58 actually governs.
      render(<ListingCard listing={aListingCardRow({ source: 'brightMLS' })} />);
      const attribution = screen.getByText('Sample Agent 1 – Real Broker, LLC').parentElement;

      expect(attribution?.className).toContain('text-sm');
      expect(attribution?.className).not.toMatch(/text-\[1[0-3]px\]|text-xs/);
    });
  });

  describe('open house', () => {
    const openHouse = {
      startsAt: '2026-09-05T15:00:00.000Z',
      endsAt: '2026-09-05T17:00:00.000Z',
      remarks: null,
    };

    /** The pill, as a whole: the label is its own element, so read the text off the parent. */
    const openHousePill = () => screen.getByText('Open:').parentElement as HTMLElement;

    /**
     * Both forms are in the DOM and a container query shows exactly one, so these read the two
     * spans rather than the pill's combined text — jsdom applies no stylesheet, so `textContent`
     * here is both forms concatenated and asserting on it would be asserting on a thing no user
     * sees.
     */
    const fullForm = () => document.querySelector('.open-house-full') as HTMLElement;
    const noDayForm = () => document.querySelector('.open-house-no-day') as HTMLElement;
    const compactForm = () => document.querySelector('.open-house-date') as HTMLElement;

    it('offers three forms, each dropping the least valuable part still present', () => {
      const { container } = render(<ListingCard listing={aListingCardRow({ openHouse })} />);

      // The weekday goes first because `9/5` already determines it; the time goes next; the date
      // never goes. "Open Sat" never said *which* Saturday, and an open house is the one listing
      // fact where being off by a week is a wasted trip to a house.
      expect(fullForm().textContent).toBe('Sat 11am–1pm (9/5)');
      expect(noDayForm().textContent).toBe('11am–1pm (9/5)');
      expect(compactForm().textContent).toBe('9/5');

      // Exactly one affordance — not the old three (pill + star chip + date row), and not the
      // pill-plus-row this briefly became.
      expect(container.textContent?.match(/Open:/g)).toHaveLength(1);
    });

    /** Only the word is bold; the schedule beside it is not. */
    it('bolds the label alone', () => {
      render(<ListingCard listing={aListingCardRow({ openHouse })} />);

      expect(screen.getByText('Open:').className).toContain('font-bold');
      expect(openHousePill().className).not.toContain('font-bold');
    });

    it('renders no open-house affordance when the API sent none', () => {
      render(<ListingCard listing={aListingCardRow({ openHouse: null })} />);

      expect(screen.queryByText('Open:')).not.toBeInTheDocument();
    });

    it('never shows an open house on a sold row, where it would mislead', () => {
      render(
        <ListingCard
          listing={aListingCardRow({ openHouse, listingType: 'sold', status: 'Sold' })}
        />,
      );

      expect(screen.queryByText('Open:')).not.toBeInTheDocument();
      expect(screen.getByText('Sold')).toBeInTheDocument();
    });

    it('does not contend with a marketing badge — they stack', () => {
      const { container } = render(
        <ListingCard
          listing={aListingCardRow({ openHouse, priceReduced: true, newConstruction: true })}
        />,
      );

      // Open house used to win the single corner slot and suppress these outright. Both pills now
      // sit in one top-left stack, so both can be true at once — which they are.
      expect(fullForm().textContent).toBe('Sat 11am–1pm (9/5)');
      expect(screen.getByText('Price reduced')).toBeInTheDocument();
      // The marketing pill itself is still one slot, filled by priority.
      expect(screen.queryByText('New construction')).not.toBeInTheDocument();

      // Marketing takes the top row, open house follows.
      const stack = container.querySelector('.absolute.inset-x-3.flex.flex-col');
      const rows = [...(stack?.children ?? [])];
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toBe('Price reduced');
      expect(rows[1]).toContainElement(screen.getByText('Open:'));
    });

    /** Brand fill, and no trace of the full-width gradient band this used to be. */
    it('fills the pill with the brand colour', () => {
      const { container } = render(<ListingCard listing={aListingCardRow({ openHouse })} />);

      const pill = openHousePill();
      expect(pill.className).toContain('bg-brand');
      expect(pill.className).toContain('text-white');
      expect(container.querySelector('.bg-gradient-to-t')).toBeNull();
    });

    /**
     * The two badges share their sizing and share the width cap that keeps them clear of the save
     * control; they deliberately differ in fill, weight and shape.
     *
     * Asserted as shared classes rather than as a set difference, because the difference is no
     * longer a short list: this badge wraps and the marketing pill truncates, which is the point of
     * it. What must not drift is the geometry — padding, type size and the width reservation — so
     * that is what is pinned.
     */
    it('shares the marketing pill’s sizing and width cap', () => {
      const withBoth = render(
        <ListingCard listing={aListingCardRow({ openHouse, priceReduced: true })} />,
      );

      const classes = (el: HTMLElement) => new Set(el.className.split(/\s+/).filter(Boolean));
      const marketing = classes(withBoth.getByText('Price reduced'));
      const openHouseClasses = classes(withBoth.getByText('Open:').parentElement as HTMLElement);

      for (const shared of ['max-w-[calc(100%-2rem)]', 'px-2', 'py-1', 'shadow-card'])
        expect([shared, marketing.has(shared), openHouseClasses.has(shared)]).toEqual([
          shared,
          true,
          true,
        ]);

      expect(openHouseClasses.has('bg-brand')).toBe(true);
      expect(marketing.has('bg-white')).toBe(true);
    });

    /**
     * The badge stays on the card's own type scale. It was briefly 8px — the only size at which the
     * full string fit a narrow card — and that was unreadable; the content adapts instead, which is
     * what the two forms above are for. Pinned because dropping the size is the tempting fix the
     * next time this does not fit.
     */
    it('stays at the card’s readable type size', () => {
      render(<ListingCard listing={aListingCardRow({ openHouse })} />);

      expect(openHousePill().className).toContain('text-[11px]');
    });

    /**
     * The whole affordance lives inside the fixed-aspect image. This is the constraint that shaped
     * every version of it: an open-house row *below* the image was the only row those cards had and
     * others did not, and it made tiles in a grid different heights.
     */
    it('keeps the whole affordance inside the image, where it costs no card height', () => {
      const { container } = render(<ListingCard listing={aListingCardRow({ openHouse })} />);

      const image = container.querySelector('.aspect-square');
      expect(image).toContainElement(screen.getByText('Open:'));
      // Nothing about it leaked into the info block below the image.
      expect(container.querySelector('.pt-2')?.textContent).not.toMatch(/Open:/);
    });

    it('never lets either image affordance displace a required disclosure label', () => {
      render(
        <ListingCard listing={aListingCardRow({ openHouse, isSample: true, sponsored: true })} />,
      );

      expect(screen.getByText('Open:')).toBeInTheDocument();
      expect(screen.getByText(/sample data/i)).toBeInTheDocument();
      expect(screen.getByText('Sponsored')).toBeInTheDocument();
    });
  });

  /**
   * Uniform tile height in a grid. The variable rows each keep a reserved box, so a parcel, a sold
   * row, a withheld-price row and an open-house row all occupy the same number of rows.
   */
  describe('grid uniformity', () => {
    it('reserves the disclosure-label slot even when a row has no labels', () => {
      const { container } = render(
        <ListingCard listing={aListingCardRow({ isSample: false, sponsored: false })} />,
      );
      expect(container.querySelector('.h-5')).toBeTruthy();
    });

    it('reserves the stats row even when there are no stats to show', () => {
      // A parcel with unknown lot size has neither a dwelling triplet nor a lot size.
      //
      // The slot is `h-[18px]`, which is `caption-sm`'s line box — it tracks the type. When the
      // stats line moved from an off-scale 12px to 13px, a box still sized for 12px would have
      // clipped it, so this assertion has to move with the type rather than be loosened.
      const { container } = render(<ListingCard listing={aLandParcelRow({ lotSqft: null })} />);
      expect(container.querySelector('.h-\\[18px\\]')).toBeTruthy();
    });

    it('renders the same row structure across a mixed set', () => {
      const rows = [
        aListingCardRow(),
        aLandParcelRow(),
        aListingCardRow({ price: null }),
        aListingCardRow({ listingType: 'sold', status: 'Sold', closePrice: 500000 }),
        aListingCardRow({ sponsored: true }),
        aListingCardRow({
          openHouse: {
            startsAt: '2026-09-05T15:00:00.000Z',
            endsAt: '2026-09-05T17:00:00.000Z',
            remarks: null,
          },
        }),
      ];

      const infoRowCounts = rows.map((row) => {
        const { container, unmount } = render(<ListingCard listing={row} />);
        // The info block's direct children are the reserved slots: label row, title, stats, price,
        // attribution. Every card must have the same number of them.
        const info = container.querySelector('.pt-2');
        const count = info?.children.length ?? 0;
        unmount();
        return count;
      });

      expect(new Set(infoRowCounts).size).toBe(1);
    });

    /**
     * The invariant most likely to be broken by a future change to the image overlays, asserted
     * structurally because jsdom computes no layout.
     *
     * A card's height is the image (fixed `aspect-square`) plus the info block. Nothing an overlay
     * does may add to either — every badge is absolutely positioned inside the image, so it is out
     * of flow and contributes no height. This has been got wrong once already: the open-house
     * date/time began as a text row below the image and made open-house tiles taller than their
     * neighbours in the grid.
     */
    it('adds no in-flow element to a card for any image overlay', () => {
      const plain = render(<ListingCard listing={aListingCardRow()} />);
      const busy = render(
        <ListingCard
          listing={aListingCardRow({
            featured: true,
            openHouse: {
              startsAt: '2026-09-05T15:00:00.000Z',
              endsAt: '2026-09-05T17:00:00.000Z',
              remarks: null,
            },
          })}
        />,
      );

      const shape = (c: HTMLElement) => {
        const image = c.querySelector('.aspect-square');
        const inFlowOverlays = [...(image?.children ?? [])].filter(
          (el) => !el.className.includes('absolute'),
        );
        return {
          // The image's only in-flow child is the photo itself, however many badges are stacked.
          inFlowChildrenOfImage: inFlowOverlays.length,
          infoRows: c.querySelector('.pt-2')?.children.length ?? 0,
        };
      };

      expect(shape(busy.container)).toEqual(shape(plain.container));
    });
  });
  /**
   * Opening a listing is the interaction this card exists for, and it has twice shipped gated on a
   * request — first on hydration, then on an intercepted route's RSC payload and chunk (measured at
   * 519ms of blank screen after the click). These cases pin the property that fixes it: the open is
   * settled in the click handler itself, synchronously, with no navigation and nothing awaited.
   */
  describe('opening the listing panel', () => {
    beforeEach(() => {
      resetListingPanel();
      window.history.replaceState(null, '', '/search?q=Bethesda%2C+MD');
    });

    it('opens the panel during the click, not after a round trip', () => {
      const row = aListingCardRow({ id: 'row-1' });
      render(<ListingCard listing={row} />);

      fireEvent.click(screen.getByRole('link'));

      // Asserted immediately after the event, with no `await` and no timer: had this gone through
      // a navigation, nothing would be open yet.
      expect(getListingPanel()).toEqual({ id: 'row-1', row });
    });

    it('hands the whole row over, so the panel can open on the listing rather than on a skeleton', () => {
      render(<ListingCard listing={aListingCardRow({ id: 'row-1', address: '9 Elm St' })} />);

      fireEvent.click(screen.getByRole('link'));

      expect(getListingPanel()?.row?.address).toBe('9 Elm St');
    });

    it('puts the listing in the address bar without leaving the page', () => {
      render(<ListingCard listing={aListingCardRow({ id: 'row-1' })} />);

      fireEvent.click(screen.getByRole('link'));

      expect(window.location.pathname).toBe('/listing/row-1');
    });

    // The card was a plain `onClick` div, so a keyboard user could not open a listing at all.
    it.each(['Enter', ' '])('opens on %s, so the card is not mouse-only', (key) => {
      render(<ListingCard listing={aListingCardRow({ id: 'row-1' })} />);

      fireEvent.keyDown(screen.getByRole('link'), { key });

      expect(getListingPanel()?.id).toBe('row-1');
    });

    it('is reachable by keyboard at all — focusable, named, and announced as a link', () => {
      render(<ListingCard listing={aListingCardRow({ neighborhood: 'Downtown' })} />);

      const card = screen.getByRole('link');
      expect(card).toHaveAttribute('tabIndex', '0');
      expect(card).toHaveAccessibleName(/Downtown/);
    });

    it('does not open the panel when the save control inside it is pressed', () => {
      render(<ListingCard listing={aListingCardRow({ id: 'row-1' })} />);

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      expect(getListingPanel()).toBeNull();
    });
  });
});
