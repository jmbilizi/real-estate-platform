import NavBar from './NavBar';
import BrandLockup from './BrandLockup';

/**
 * SiteHeader — sticky 64px header.
 *
 * CompactSearchBar (the search bar, in all its layouts — in-page, header pill,
 * click-to-expand overlay) is a single always-mounted instance rendered from
 * ScrollSentinel, docking into this header's pill slot / the space below it
 * via position:fixed when scrolled. Nothing search-related is rendered here.
 *
 * Phones (#943): the sticky row holds Apps, the search pill and Account, so it has no room for the
 * logo. The 28px brand line above it is the same `BrandLockup` the desktop header draws (#946,
 * #1048). It sits in the server HTML and in the first 25 percent of the page.
 * It scrolls away with the page and is not sticky, so it never covers content.
 */
export default function SiteHeader() {
  return (
    <>
      <div
        data-testid="mobile-brand-line"
        className="flex h-7 items-center justify-center bg-white md:hidden"
      >
        <BrandLockup variant="line" />
      </div>
      <div className="site-header-wrapper sticky top-0 z-chrome bg-white overflow-visible">
        <NavBar />
      </div>
    </>
  );
}
