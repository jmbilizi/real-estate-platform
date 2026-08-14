import ListingModalFrame from '@/components/listing/ListingModalFrame';
import { ListingDetailSkeleton } from '@/components/listing/ListingStates';

/**
 * Shown the instant a card is clicked.
 *
 * Intercepting a route is still a navigation: the browser has to fetch this segment's payload
 * before anything in it can render, and until it lands there is nothing on screen but the results
 * page and a progress bar. That round trip is short but it is dead time, and it made a click feel
 * like it had not registered.
 *
 * This is the Suspense boundary that removes it. The panel and its skeleton are already in the
 * bundle, so they paint on the click itself, and the resolved modal takes over underneath the same
 * chrome once the payload arrives.
 */
export default function LoadingInterceptedListing() {
  return (
    <ListingModalFrame>
      <ListingDetailSkeleton />
    </ListingModalFrame>
  );
}
