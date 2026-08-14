import ListingDetailModal from '@/components/ListingDetailModal';

/**
 * A **soft** navigation to a listing — a card click, a map pin.
 *
 * The page you came from stays mounted underneath, so this deliberately does *not* resolve the
 * listing server-side the way `/listing/[id]` does. Waiting on the API here would delay the modal
 * opening at all, which is the one thing a click has to feel instant; opening straight onto the
 * skeleton and filling it in is the better trade when there is already a page on screen. Reopening
 * a listing looked at earlier costs nothing either way — the detail cache serves it.
 */
export default async function ListingModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingDetailModal id={id} />;
}
