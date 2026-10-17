import Link from 'next/link';
import NavBar from './NavBar';
import { BRAND } from '@/lib/brand';

/**
 * SiteHeader — sticky 64px header.
 *
 * CompactSearchBar (the search bar, in all its layouts — in-page, header pill,
 * click-to-expand overlay) is a single always-mounted instance rendered from
 * ScrollSentinel, docking into this header's pill slot / the space below it
 * via position:fixed when scrolled. Nothing search-related is rendered here.
 *
 * Phones (#943): the sticky row holds Apps, the search pill and Account, so it has no room for the
 * logo. The brand line above it keeps Real Broker, LLC in the server HTML and in view on arrival.
 * It scrolls away with the page and is not sticky, so it never covers content.
 */
export default function SiteHeader() {
  return (
    <>
      <div
        data-testid="mobile-brand-line"
        className="flex h-11 items-center justify-center bg-white md:hidden"
      >
        <Link href="/" className="flex min-h-11 items-center gap-2" aria-label={BRAND.brokerage}>
          <span className="font-display text-base font-bold leading-tight">{BRAND.brokerage}</span>
          <span className="flex gap-1 font-display text-xs leading-tight" aria-hidden="true">
            <span>CRIB</span>
            <span className="text-brand">STOP</span>
          </span>
        </Link>
      </div>
      <div className="site-header-wrapper sticky top-0 z-chrome bg-white overflow-visible">
        <NavBar />
      </div>
    </>
  );
}
