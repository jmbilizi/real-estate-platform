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
 * logo. The 28px brand line above it reads "CRIBSTOP at Real Broker, LLC" (#946). Only "at" may
 * join the two names (MD COMAR 09.11.02.01G(5)): no symbol or image between them. The line sits in
 * the server HTML and in the first 25 percent of the page.
 * It scrolls away with the page and is not sticky, so it never covers content.
 */
export default function SiteHeader() {
  return (
    <>
      <div
        data-testid="mobile-brand-line"
        className="flex h-7 items-center justify-center bg-white md:hidden"
      >
        <Link
          href="/"
          className="relative flex items-baseline gap-1 whitespace-nowrap font-display leading-none before:absolute before:-inset-y-2 before:-inset-x-2 before:content-['']"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-brand">
            {BRAND.siteName}
          </span>
          <span className="text-xs text-ink-muted">at</span>
          <span className="text-sm font-semibold text-ink">{BRAND.brokerage}</span>
        </Link>
      </div>
      <div className="site-header-wrapper sticky top-0 z-chrome bg-white overflow-visible">
        <NavBar />
      </div>
    </>
  );
}
