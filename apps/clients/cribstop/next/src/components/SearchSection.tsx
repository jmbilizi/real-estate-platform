'use client';

import { useEffect, useRef } from 'react';
import { useApp } from '@/lib/context';
import CompactSearchBar from './CompactSearchBar';

/**
 * SearchSection — drives header tabs ↔ compact pill swap.
 *
 * Uses two mechanisms in parallel:
 * 1. `data-header-pill` on <html> — set synchronously in the scroll handler
 *    so CSS can toggle visibility in the same frame, with zero React lag.
 * 2. React state (setShowHeaderPill) — kept in sync for other consumers (e.g.
 *    expanded search row, backdrop).
 */
export default function SearchSection() {
  const { setShowHeaderPill, setMobileSearchOpen } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const pillRef = useRef(false);

  useEffect(() => {
    // Set initial state — no pill at mount
    document.documentElement.removeAttribute('data-header-pill');
    setShowHeaderPill(false);
    pillRef.current = false;

    // Compute header height once so the threshold is dynamic
    const headerEl = document.querySelector('header');
    const headerH = headerEl?.getBoundingClientRect().height ?? 64;

    // Cache the section's offsetTop NOW (before any display:none hides it).
    // We can't use getBoundingClientRect() inside the scroll handler because
    // display:none makes it return all-zeros, causing the pill to never turn off.
    const sectionTop = ref.current?.getBoundingClientRect().top
      ? ref.current.getBoundingClientRect().top + window.scrollY
      : 0;

    const check = () => {
      // scrollY >= sectionTop means the top of the section has reached the header
      const shouldShow = window.scrollY > sectionTop - headerH + 4;
      // 1. Directly toggle the CSS attribute — zero React latency, same frame as scroll
      if (shouldShow) {
        document.documentElement.setAttribute('data-header-pill', '');
        window.dispatchEvent(new Event('searchbar:close'));
      } else {
        document.documentElement.removeAttribute('data-header-pill');
      }
      // 2. Sync React state only when it actually changes (avoids excess re-renders)
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
      setShowHeaderPill(true);
    };
  }, [setShowHeaderPill]);

  return (
    <div ref={ref} className="search-section w-full">
      {/* Mobile: Airbnb-style floating pill (MobileSearchSheet rendered in Header) */}
      <div className="sm:hidden px-4 py-3">
        <button
          onClick={() => setMobileSearchOpen(true)}
          aria-label="Open search"
          className="w-full flex items-center gap-3 rounded-full border border-[rgba(0,0,0,0.12)] bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_10px_rgba(0,0,0,0.07)] active:scale-[0.99] transition-transform"
        >
          <svg
            className="h-4 w-4 flex-shrink-0 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <div className="flex flex-col text-left min-w-0 flex-1">
            <span className="text-[14px] font-semibold text-ink leading-tight">Where to?</span>
            <span className="text-[12px] text-ink-muted leading-snug">
              Anywhere · Anytime · Add guests
            </span>
          </div>
          <span className="flex-shrink-0 h-8 w-8 rounded-full border border-[rgba(0,0,0,0.12)] flex items-center justify-center">
            <svg
              className="h-3.5 w-3.5 text-ink"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"
              />
            </svg>
          </span>
        </button>
      </div>

      {/* Desktop: full 4-slot search bar */}
      <div className="hidden sm:block border-b border-surface-border bg-white">
        <CompactSearchBar />
      </div>
    </div>
  );
}
