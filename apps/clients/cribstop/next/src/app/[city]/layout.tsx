import ScrollSentinel from '@/components/ScrollSentinel';

/**
 * Layout for `/<city>-<st>` catch-all routes (#349 property pages; #350 adds search paths under
 * the same prefix).
 *
 * `ScrollSentinel` is the only thing that mounts `CompactSearchBar` — the single always-mounted
 * search bar instance, in-page or docked in the header. See the identical note in
 * `listing/[id]/layout.tsx`: this route sits outside every route group, so without this it would
 * be the second page in the app with an incomplete nav.
 */
export default function CityPathLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScrollSentinel />
      {children}
    </>
  );
}
