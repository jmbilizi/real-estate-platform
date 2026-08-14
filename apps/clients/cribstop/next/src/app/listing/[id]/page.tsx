import ListingDetailModal from '@/components/ListingDetailModal';
import ListingSearchBackdrop from '@/components/listing/ListingSearchBackdrop';
import { loadListingState } from '@/lib/api/listings-server';

/**
 * A **hard** navigation to a listing — a shared link, a bookmark, a reload.
 *
 * This used to `redirect('/?listing=<id>')`, which made opening a listing URL the slowest thing the
 * app does: a redirect round trip, then a full homepage render, then the homepage's own six API
 * calls, all before the client had even mounted the modal. The listing the user actually asked for
 * was the 7th request. Rendering the listing here removed the redirect and the homepage.
 *
 * What that did not fix was the *order things appear in*. The modal was still a client component
 * that fetched after hydration, and `Modal` renders nothing until an effect has run — so the
 * document went out with an empty `<main>`, the browser painted a bare header and footer, and only
 * then did the listing pop in over it. Resolving the listing here instead means the panel is in the
 * first HTML, fully populated, with no client request at all.
 *
 * The city's search results then mount *behind* it, from an effect, so a direct load ends up
 * looking like an intercepted one — and closing the modal reveals a page that is already there.
 * The ordering is deliberate and one-way: the listing cannot wait on the backdrop, only the
 * reverse. `loading.tsx` covers the server fetch.
 *
 * Soft navigation does not land here: a card click pushes this same URL and
 * `@modal/(.)listing/[id]` intercepts it into a modal over the page you were on, which stays
 * mounted underneath. Only a hard navigation reaches this file, which is why it passes `closeHref`
 * — there is no history entry behind it to step back to.
 */
export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initialState = await loadListingState(id);

  /**
   * The search that would have produced this listing.
   *
   * `q` is the same parameter the search bar builds, so this is the city's real result set rather
   * than a decorative approximation — and the same string serves as the close destination, which
   * is what makes closing continuous with what was already on screen. A listing that failed to
   * load has no city to search, so there is nothing to put behind it and close falls back.
   *
   * The **city alone**, deliberately, not "City, ST". `query` is free text matched against title,
   * address, city, neighborhood and zip *individually*, so a value spanning two fields matches
   * none of them and comes back empty. (The search bar builds exactly that shape today, which is
   * its own bug, filed separately — but it is not one to reproduce here.) The cost is that a city
   * name
   * shared across states matches both; the brokerage is MD/DC/VA only, and an occasional extra
   * result behind the panel is far cheaper than a backdrop that is reliably empty.
   */
  const cityQuery =
    initialState.status === 'ready' ? `q=${encodeURIComponent(initialState.listing.city)}` : null;

  return (
    <>
      {cityQuery && <ListingSearchBackdrop query={cityQuery} />}
      <ListingDetailModal
        id={id}
        initialState={initialState}
        closeHref={cityQuery ? `/search?${cityQuery}` : '/search'}
      />
    </>
  );
}
