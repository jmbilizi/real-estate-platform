'use client';

import { useEffect, useRef } from 'react';
import { useApp } from '@/lib/context';
import CompactSearchBar from './CompactSearchBar';
import MobileSearchPill from './MobileSearchPill';

/**
 * ScrollSentinel — scroll position detector + page-level search bar.
 *
 * Used on every page. Two modes:
 *
 * Default (`alwaysPill` omitted):
 *   Renders the desktop full search bar + mobile pill in page flow.
 *   When the search bar scrolls past the sticky header, sets `data-header-pill`
 *   on <html> so CSS swaps to the compact pill — zero React re-render lag.
 *
 * `alwaysPill` mode (listing detail, etc.):
 *   Activates `data-header-pill` immediately on mount (no search bar in page flow).
 *   Pill stays active for the full page lifetime — no scroll detection needed.
 *   Same CSS/state path as the scroll-based mode.
 */
export default function ScrollSentinel({ alwaysPill = false }: { alwaysPill?: boolean }) {
  const { setShowHeaderPill } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const pillRef = useRef(false);

  useEffect(() => {
    if (alwaysPill) {
      // Immediately lock into pill mode for the lifetime of this page
      document.documentElement.setAttribute('data-header-pill', '');
      setShowHeaderPill(true);
      pillRef.current = true;
      return () => {
        document.documentElement.removeAttribute('data-header-pill');
        setShowHeaderPill(false);
      };
    }

    // Scroll-based mode — set initial state
    document.documentElement.removeAttribute('data-header-pill');
    setShowHeaderPill(false);
    pillRef.current = false;

    // Compute header height once so the threshold is dynamic
    const headerEl = document.querySelector('header');
    const headerH = headerEl?.getBoundingClientRect().height ?? 64;

    // Cache the sentinel's offsetTop
    const sectionTop = ref.current?.getBoundingClientRect().top
      ? ref.current.getBoundingClientRect().top + window.scrollY
      : 0;

    const check = () => {
      // Activate pill when the in-page search bar scrolls behind the header
      const shouldShow = window.scrollY > sectionTop - headerH;

      if (shouldShow === pillRef.current) return;

      if (shouldShow) {
        document.documentElement.setAttribute('data-header-pill', '');
        window.dispatchEvent(new Event('searchbar:close'));
      } else {
        document.documentElement.removeAttribute('data-header-pill');
        document.documentElement.removeAttribute('data-header-expanded');
      }

      pillRef.current = shouldShow;
      setShowHeaderPill(shouldShow);
    };

    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });

    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      document.documentElement.removeAttribute('data-header-pill');
      setShowHeaderPill(false);
    };
  }, [alwaysPill, setShowHeaderPill]);

  return (
    <div ref={ref} className="search-section w-full relative">
      {/* Desktop: full search bar in page flow — scrolls away naturally */}
      {!alwaysPill && (
        <div className="hidden md:block bg-white">
          <CompactSearchBar />
        </div>
      )}

      {/* Mobile only: search pill */}
      {!alwaysPill && (
        <div className="md:hidden px-4 py-3 bg-white flex">
          <MobileSearchPill />
        </div>
      )}
      {/* Gradient fade divider */}
      {!alwaysPill && (
        <div
          className="h-3 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.07), transparent)' }}
        />
      )}
    </div>
  );
}
