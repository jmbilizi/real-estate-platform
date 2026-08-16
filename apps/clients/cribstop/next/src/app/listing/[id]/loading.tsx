import ListingModalFrame from '@/components/listing/ListingModalFrame';
import ListingSearchBackdrop from '@/components/listing/ListingSearchBackdrop';
import { ListingDetailSkeleton } from '@/components/listing/ListingStates';

/**
 * Streamed while the page resolves the listing on the server.
 *
 * The page awaits the Property API before it renders anything, which is what puts the finished
 * listing in the first HTML. This is the cover for that wait: the panel and its skeleton ship
 * immediately, in the same chrome the loaded listing uses, so a slow upstream reads as a listing
 * filling in rather than as a blank page.
 *
 * The backdrop is here for the same reason and was the piece missing from it. This state is what
 * the browser paints *first* on a reload, and with only the panel in it the body behind was empty
 * until the page's own HTML arrived — so the results did not fade in, they appeared, and the page
 * read as having been blank and then rebuilt. It holds the shape only: there is no city to search
 * for until the listing resolves, so it renders the split layout, the map frame and the card
 * skeletons and starts nothing. The resolved page then renders the same shell with the listing's
 * city in it, and the swap is invisible.
 */
export default function LoadingListing() {
  return (
    <>
      <ListingSearchBackdrop />
      <ListingModalFrame>
        <ListingDetailSkeleton />
      </ListingModalFrame>
    </>
  );
}
