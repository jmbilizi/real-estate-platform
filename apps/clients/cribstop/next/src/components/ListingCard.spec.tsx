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
    it('renders the agent name, a contact method and the office name', () => {
      render(<ListingCard listing={aListingCardRow()} />);

      expect(screen.getByText('Sample Agent 1 – Real Broker, LLC')).toBeInTheDocument();
      expect(screen.getByText('(301) 555-0101')).toBeInTheDocument();
      expect(screen.getByText('sample.agent1@example.com')).toBeInTheDocument();
      expect(screen.getByText(/Listing courtesy of Real Broker, LLC/)).toBeInTheDocument();
    });

    it('renders listedBy as delivered rather than reassembling it from parts', () => {
      render(
        <ListingCard listing={aListingCardRow({ listedBy: 'Jane Q. Agent – Real Broker, LLC' })} />,
      );
      expect(screen.getByText('Jane Q. Agent – Real Broker, LLC')).toBeInTheDocument();
    });

    it('keeps the attribution at or above the median type size used for the listing data', () => {
      // Listing data on the card renders at 14px (location), 12px (stats) and 14px (price), so the
      // median is 14px — `text-sm`. Anything smaller fails 7.58's typeface floor.
      const { container } = render(<ListingCard listing={aListingCardRow()} />);
      const attribution = screen.getByText(/Listing courtesy of/).parentElement;

      expect(attribution?.className).toContain('text-sm');
      expect(attribution?.className).not.toMatch(/text-\[1[0-3]px\]|text-xs/);
      expect(container).toBeTruthy();
    });
  });

  describe('open house', () => {
    it('renders the occurrence the API sent', () => {
      render(
        <ListingCard
          listing={aListingCardRow({
            openHouse: {
              startsAt: '2026-09-05T15:00:00.000Z',
              endsAt: '2026-09-05T17:00:00.000Z',
              remarks: null,
            },
          })}
        />,
      );

      // The badge carries the words; the line carries the when. Both are driven by `openHouse`.
      expect(screen.getByText('Open house')).toBeInTheDocument();
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText(/Sep 5/)).toBeInTheDocument();
    });

    it('renders no open-house affordance when the API sent none', () => {
      render(<ListingCard listing={aListingCardRow({ openHouse: null })} />);

      expect(screen.queryByText(/Open house/)).not.toBeInTheDocument();
      expect(screen.queryByText('Open')).not.toBeInTheDocument();
    });
  });
});
