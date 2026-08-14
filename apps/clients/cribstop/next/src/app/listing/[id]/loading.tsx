import ListingModalFrame from '@/components/listing/ListingModalFrame';
import { ListingDetailSkeleton } from '@/components/listing/ListingStates';

/**
 * Streamed while the page resolves the listing on the server.
 *
 * The page awaits the Property API before it renders anything, which is what puts the finished
 * listing in the first HTML. This is the cover for that wait: the panel and its skeleton ship
 * immediately, in the same chrome the loaded listing uses, so a slow upstream reads as a listing
 * filling in rather than as a blank page.
 */
export default function LoadingListing() {
  return (
    <ListingModalFrame>
      <ListingDetailSkeleton />
    </ListingModalFrame>
  );
}
