import { render, screen } from '@testing-library/react';
import { aLandParcelRow, aListingCardRow, aSuppressedAddressRow } from '@/test/fixtures';
import ListingCard from './ListingCard';

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
      expect(screen.getByText(/Listing by Bright Partner Realty/)).toBeInTheDocument();
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

    it('renders the whole statement — label, weekday, calendar date and time range', () => {
      const { container } = render(<ListingCard listing={aListingCardRow({ openHouse })} />);

      // The date is the point. "Open Sat" never said *which* Saturday, and an open house is the
      // one listing fact where being off by a week is a wasted trip to a house. Asserted as exact
      // visible strings: this used to be abbreviated in a pill with the real value hidden behind
      // `title`, which is not the same as a consumer being able to read it.
      expect(screen.getByText('Open house')).toBeInTheDocument();
      expect(screen.getByText('Sat, Sep 5 · 11am–1pm')).toBeInTheDocument();

      // Still exactly one affordance, not the old three (pill + star chip + date row).
      expect(container.textContent?.match(/Open house/g)).toHaveLength(1);
    });

    it('renders no open-house affordance when the API sent none', () => {
      render(<ListingCard listing={aListingCardRow({ openHouse: null })} />);

      expect(screen.queryByText(/Open house/)).not.toBeInTheDocument();
      expect(screen.queryByText('Open')).not.toBeInTheDocument();
    });

    it('never shows an open house on a sold row, where it would mislead', () => {
      render(
        <ListingCard
          listing={aListingCardRow({ openHouse, listingType: 'sold', status: 'Sold' })}
        />,
      );

      expect(screen.queryByText(/Open house/)).not.toBeInTheDocument();
      expect(screen.getByText('Sold')).toBeInTheDocument();
    });

    it('no longer contends with a marketing badge, now that it has its own band', () => {
      render(
        <ListingCard
          listing={aListingCardRow({ openHouse, priceReduced: true, newConstruction: true })}
        />,
      );

      // Open house used to win the single corner slot and suppress these outright. It sits at the
      // foot of the image now, so both can be true at once — which they are.
      expect(screen.getByText(/^Open house/)).toBeInTheDocument();
      expect(screen.getByText('Price reduced')).toBeInTheDocument();
      // The pill itself is still one slot, filled by priority.
      expect(screen.queryByText('New construction')).not.toBeInTheDocument();
    });

    it('never lets either image affordance displace a required disclosure label', () => {
      render(
        <ListingCard listing={aListingCardRow({ openHouse, isSample: true, sponsored: true })} />,
      );

      expect(screen.getByText(/^Open house/)).toBeInTheDocument();
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
  });
});
