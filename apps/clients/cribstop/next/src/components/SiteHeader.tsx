import NavBar from './NavBar';

/**
 * SiteHeader — sticky 64px header.
 *
 * CompactSearchBar (the header search field and its open state) is a single always-mounted
 * instance rendered from ScrollSentinel. It is fixed over this header's pill slot. Nothing
 * search-related is rendered here.
 *
 * The brand is the "cs" mark in the row itself (`BrandMark` in `NavBar`), at every width. There is
 * no brand text line above the header (stakeholder decision 2026-11-24).
 */
export default function SiteHeader() {
  return (
    <div className="site-header-wrapper sticky top-0 z-chrome bg-white overflow-visible">
      <NavBar />
    </div>
  );
}
