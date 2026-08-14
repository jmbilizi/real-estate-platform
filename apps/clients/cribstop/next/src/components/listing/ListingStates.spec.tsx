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

      expect(screen.getByRole('img')).toBeInTheDocument();
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
});
