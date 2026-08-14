'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ListingDetailModal from '@/components/ListingDetailModal';
import ListingSearchBackdrop from '@/components/listing/ListingSearchBackdrop';
import type { ListingDetailState } from '@/lib/api/listings';

/**
 * A directly-loaded listing, and what closing it does.
 *
 * Closing used to `router.push('/search?…')`. That is a navigation to a *different route*, so the
 * search results already mounted and fully loaded behind the panel were unmounted and a second copy
 * built from scratch — measured: the results refetched, the city geocoded twice more (two Nominatim
 * calls became six), and every map tile reloaded. The user's own words for it were that going back
 * "still reload[s] the search page", which is exactly what it did.
 *
 * Nothing needs to be navigated to, because the destination is already on screen. Closing hands the
 * URL over to the results behind the panel and lets them start owning it — one state flip, no
 * unmount, no refetch.
 */
export default function StandaloneListingView({
  id,
  initialState,
  cityQuery,
}: {
  id: string;
  initialState: ListingDetailState;
  /**
   * The search that would have produced this listing, as a query string — or null when the listing
   * failed to load and there is therefore no city to fall back on.
   */
  cityQuery: string | null;
}) {
  const router = useRouter();

  /**
   * One-way latch: has *this* panel been dismissed?
   *
   * Only ever set, never cleared, because it answers a question about this render of the standalone
   * route and nothing that happens afterwards can un-dismiss it. A listing opened later comes from
   * the intercepted route instead, over the top.
   */
  const [dismissed, setDismissed] = useState(false);

  /**
   * Whether the results behind are the page the user is looking at, as opposed to a backdrop with
   * something over it.
   *
   * The latch alone is not enough. Once dismissed, clicking a card on the revealed results opens the
   * *intercepted* listing modal above this same tree — so the results would be left interactive and
   * in the accessibility tree underneath an open panel, which is the exact thing `inert` is there to
   * prevent, and they would go on owning a URL that had become a listing's.
   *
   * The pathname answers both. It tracks `history.replaceState` below, because Next.js keeps
   * `usePathname` in step with the native History API.
   */
  const pathname = usePathname();
  const showingResults = dismissed && !pathname.startsWith('/listing/');

  const handleClosed = () => {
    /*
     * With nothing behind the panel there is nothing to reveal, so this is the one case that still
     * has to navigate.
     */
    if (!cityQuery) {
      router.push('/search');
      return;
    }

    /*
     * `history.replaceState` rather than a router navigation, deliberately. Next.js supports the
     * native History API and keeps `usePathname`/`useSearchParams` in step with it, so the address
     * bar becomes the search URL — shareable, reloadable, correct — while the rendered tree is left
     * alone. A `router.push`/`replace` would re-render the route and undo the entire point.
     *
     * It runs before the flip so that the search results, which begin reading the URL on that same
     * flip, find the URL they expect and not the listing's.
     */
    window.history.replaceState(null, '', `/search?${cityQuery}`);
    setDismissed(true);
  };

  return (
    <>
      {cityQuery && <ListingSearchBackdrop query={cityQuery} live={showingResults} />}
      {!dismissed && (
        <ListingDetailModal id={id} initialState={initialState} onClosed={handleClosed} />
      )}
    </>
  );
}
