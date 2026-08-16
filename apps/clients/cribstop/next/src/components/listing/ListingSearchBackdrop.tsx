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
 * **It must never compete with the listing for anything** — but "not competing" is about requests,
 * not about pixels, and conflating the two is what this used to get wrong. It rendered `null` until
 * two frames after hydration, which kept its requests off the critical path by not existing at all:
 * a directly-loaded listing went out with an *empty body* behind the panel, and the results later
 * appeared as a page popping into being. Reported exactly that way — the body disappears, then
 * reappears — and it is the one thing a skeleton exists to prevent. Worse, the search already had
 * good loading states (card skeletons, a framed map placeholder) and none of them could be seen,
 * because the component that owns them had not mounted.
 *
 * So the two requirements are separated. The shell renders from the first paint, server-side and
 * fully shaped; `deferred` is what holds the work — the results query, the two geocode calls, the
 * map chunk and its tiles — until the listing has been painted. The listing still renders first;
 * what fills in behind it is now content arriving into a space that was already there.
 */
export default function ListingSearchBackdrop({
  query,
  live = false,
}: {
  /**
   * The search to run behind the listing — or omitted, which holds the shell open forever.
   *
   * Omitted is the route's `loading.tsx`, which is on screen precisely while the server is still
   * resolving the listing and therefore does not yet know its city. It has no search to run, but it
   * does have a shape to hold: without one, the streamed HTML is a modal skeleton over an empty
   * body, and the results appear only when the page itself arrives. That was the second half of
   * the blank flash, and it is the half that survived fixing the first.
   */
  query?: string;
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
  const [released, setReleased] = useState(false);

  useEffect(() => {
    if (query === undefined) return;

    /*
     * Two frames, not one. A callback scheduled in an effect runs *before* the browser has painted
     * the listing; the frame after that runs once it has. Releasing on the second is what keeps the
     * backdrop's work off the critical path rather than merely late in it.
     */
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReleased(true));
    });

    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [query]);

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
      <SearchExperience initialQuery={query} ownsUrl={live} deferred={!released} />
    </div>
  );
}
