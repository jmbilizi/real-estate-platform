import NavBar from './NavBar';

/**
 * SiteHeader — sticky 64px header.
 *
 * CompactSearchBar (the search bar, in all its layouts — in-page, header pill,
 * click-to-expand overlay) is a single always-mounted instance rendered from
 * ScrollSentinel, docking into this header's pill slot / the space below it
 * via position:fixed when scrolled. Nothing search-related is rendered here.
 */
export default function SiteHeader() {
  return (
    <div className="site-header-wrapper sticky top-0 z-chrome bg-white overflow-visible">
      <NavBar />
    </div>
  );
}
