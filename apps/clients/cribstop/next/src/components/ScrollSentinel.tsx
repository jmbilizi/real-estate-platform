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

    // Cache the sentinel's offsetTop NOW (before display:none could hide it).
    const sectionTop = ref.current?.getBoundingClientRect().top
      ? ref.current.getBoundingClientRect().top + window.scrollY
      : 0;

    const check = () => {
      // Activate pill when search bar top has reached the sticky header bottom.
      // No hysteresis offset — threshold aligns exactly with when the search bar
      // visually passes behind the header, so there's no gap where neither divider shows.
      const shouldShow = window.scrollY > sectionTop - headerH;
      // Toggle CSS attribute synchronously — same paint frame as scroll
      if (shouldShow) {
        document.documentElement.setAttribute('data-header-pill', '');
        window.dispatchEvent(new Event('searchbar:close'));
      } else {
        // Remove both pill and expanded in the same frame so the expanded bar
        // CSS transition fires immediately (avoids border-jump flash at navbar line)
        document.documentElement.removeAttribute('data-header-pill');
        document.documentElement.removeAttribute('data-header-expanded');
      }
      // Sync React state only when value changes (avoids excess re-renders)
      if (shouldShow !== pillRef.current) {
        pillRef.current = shouldShow;
        setShowHeaderPill(shouldShow);
      }
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
      {/* Desktop: full search bar in page flow — scrolls away naturally, triggers compact pill */}
      {!alwaysPill && (
        <div className="hidden md:block bg-white">
          <CompactSearchBar />
        </div>
      )}

      {/* Mobile only: search pill — shared component so pre/post-scroll always match */}
      <div className="md:hidden px-4 py-3 bg-white flex">
        <MobileSearchPill />
      </div>
      {/* Gradient fade divider — inside search-section (z-[1]) so it paints above page content */}
      <div
        className="h-3 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.07), transparent)' }}
      />
    </div>
  );
}
