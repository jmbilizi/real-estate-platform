import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for a directly-loaded listing.
 *
 * `ScrollSentinel` is the only thing that mounts `CompactSearchBar` — the single always-mounted
 * search bar instance, in-page or docked in the header — so a route without one renders a header
 * with its search slot simply missing. Every route group's layout mounts one; this route sits
 * outside all of them, which is how it ended up as the one page in the app with an incomplete nav.
 *
 * Scroll-based mode rather than `alwaysPill`, to match the page underneath. The backdrop is the
 * city's search results, and `/search` carries the in-page bar with its results below it — so the
 * pill variant would seat that content ~100px higher here than on the route the close button leads
 * to, and closing would jump. The modal locks scrolling anyway, so the sentinel simply rests in its
 * unscrolled state for the page's lifetime, which is also what an intercepted open looks like.
 */
export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
