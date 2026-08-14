'use client';

import { useEffect, useState } from 'react';
import SearchExperience from '@/components/SearchExperience';

/**
 * The search results page, rendered behind a directly-loaded listing.
 *
 * Opening a listing from a results page leaves that page mounted underneath, so closing the modal
 * restores it instantly. A direct load — a shared link, a bookmark, a reload — had nothing behind
 * it at all: a bare header and footer, and a close button that navigated off to a generic search.
 * This puts the listing's own city back there, so both ways of arriving look and behave the same.
 *
 * **It must never compete with the listing for anything.** It mounts from an effect, so it is
 * absent from the server HTML entirely and none of its requests — the results query, the two
 * geocode calls, the map tiles — can start until the listing has been painted. That ordering is
 * the whole point: the thing the user asked for renders first, and the context fills in behind it.
 */
export default function ListingSearchBackdrop({
  query,
  live = false,
}: {
  query: string;
  /**
   * Whether the modal in front has closed and this is now the page.
   *
   * The two things this switches are the same thing said twice: a backdrop is inert and does not
   * own the URL, a page is interactive and does. Flipping it is what lets closing a directly-loaded
   * listing *reveal* these results rather than navigate to a second copy of them — which threw away
   * a fully-loaded search and rebuilt it, refetching the results, re-geocoding the city twice over
   * and reloading every map tile.
   */
  live?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    /*
     * Two frames, not one. A callback scheduled in an effect runs *before* the browser has painted
     * the listing; the frame after that runs once it has. Mounting on the second is what keeps the
     * backdrop's work off the critical path rather than merely late in it.
     */
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMounted(true));
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  if (!mounted) return null;

  return (
    /*
     * Inert while the listing is over it, not merely visually behind. The panel covers most of the
     * viewport, so every control down here — the filter button, the sort menu, each card — is either
     * hidden or a sliver at the edge of the screen. `inert` takes the whole subtree out of the tab
     * order, out of the accessibility tree and out of pointer handling in one step.
     *
     * Both attributes have to come off together once this is the page, or the results would be
     * visible and unusable.
     */
    <div
      data-search-backdrop={live ? 'live' : 'inert'}
      inert={!live}
      aria-hidden={!live || undefined}
    >
      <SearchExperience initialQuery={query} ownsUrl={live} />
    </div>
  );
}
