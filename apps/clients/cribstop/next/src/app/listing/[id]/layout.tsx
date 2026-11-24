import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for a directly-loaded listing.
 *
 * `ScrollSentinel` is the only thing that mounts `CompactSearchBar` — the single always-mounted
 * search bar instance, in-page or docked in the header — so a route without one renders a header
 * with its search slot simply missing. Every route group's layout mounts one; this route sits
 * outside all of them, which is how it ended up as the one page in the app with an incomplete nav.
 */
export default function ListingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
