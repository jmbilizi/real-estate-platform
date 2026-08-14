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
   * Whether the results behind are the page the user is looking at, as opposed to a backdrop with
   * something over it.
   *
   * The pathname is what answers it, and it tracks `history.replaceState` below because Next.js
   * keeps `usePathname` in step with the native History API. It matters beyond the panel's own
   * visibility: once dismissed, clicking a card on the revealed results opens a listing panel above
   * this same tree, and these results must go inert for that — otherwise they stay interactive and
   * in the accessibility tree underneath an open panel, which is the thing `inert` exists to stop.
   */
  const pathname = usePathname();
  const onListingUrl = pathname.startsWith('/listing/');

  /**
   * Has *this* panel been dismissed?
   *
   * **Seeded from the URL rather than starting `false`**, and that is a bug fix rather than a
   * flourish. `handleClosed` rewrites the address bar with `history.replaceState`, which changes the
   * URL of the current history entry but *not* the route tree Next has stored against it — that
   * entry still points at `/listing/[id]`. So navigating away with an in-app `Link` and pressing
   * Back restored this component fresh, with a `false` latch, and it drew the listing panel again
   * over an address bar reading `/search?q=…`. Reproduced: direct-load a listing, close it, soft-nav
   * to `/favorites`, press Back — the panel was on screen with the search URL behind it, every time.
   *
   * Deriving the initial value from the pathname makes the latch survive that round trip, because
   * the URL is the thing `replaceState` *did* update. It is still one-way within a mount: nothing
   * that happens afterwards can un-dismiss it.
   *
   * No hydration hazard: on a genuine direct load the server and the first client render both see
   * `/listing/[id]`, so both start `false`. Only a restored entry — which is a client-side render
   * with no server pass to disagree with — starts `true`.
   */
  const [dismissed, setDismissed] = useState(() => !onListingUrl);

  const showingResults = dismissed && !onListingUrl;

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
