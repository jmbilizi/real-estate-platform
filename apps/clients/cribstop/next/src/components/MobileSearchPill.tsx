'use client';

import { useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/context';
import { LISTING_TYPE_SUMMARY_LABELS } from '@/lib/listing-type-labels';
import { SkeletonBar } from './Skeleton';
import { parseSearchPath } from '@cribstop/property-contracts';

/**
 * Shared mobile search pill used in both ScrollSentinel (in-page, pre-scroll)
 * and NavBar (overlay, post-scroll). Reads everything from context so both
 * places always display the same content.
 *
 * The caller is responsible for the outer container / positioning wrapper.
 */
export default function MobileSearchPill() {
  const { searchLocation, searchListingType, activeTab, setMobileSearchOpen } = useApp();
  const pathname = usePathname();

  const [hydrated, setHydrated] = useState(false);
  useLayoutEffect(() => {
    setHydrated(true);
  }, []);

  // `searchSlice`'s default is always '' and is never persisted (see the slice's own comment).
  // So on every route except a search path (#350) there is no async seeding: the server and the first
  // client render already agree, and there is nothing to placeholder over.
  const onSearchRoute = parseSearchPath(pathname.split('/')) !== null;

  const summary = (() => {
    if (activeTab === 'services') return 'Find services';
    if (activeTab === 'connect') return 'Explore connect';
    return LISTING_TYPE_SUMMARY_LABELS[searchListingType];
  })();

  /*
   * On `/search` only, this component cannot pick its layout before hydration.
   * `SearchExperience` seeds `searchLocation` from the URL in an effect, mounted only on that
   * route. So `/search?q=...` sees an empty string server-side, and without a placeholder would
   * render the one-line "Start your search" button, then swap to the two-line pill. That is a
   * height change, not just a text change. The placeholder takes the two-line shape so the swap
   * lands inside a box that is already the right size. Every other route has no such effect, so
   * `searchLocation` is already the settled answer server-side.
   */
  if (!hydrated && onSearchRoute) {
    return (
      <div className="flex-1 flex items-center rounded-full border border-surface-border bg-white shadow-card overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center text-center px-4 py-2.5">
          <span className="text-[13px] font-semibold leading-snug w-full">
            <SkeletonBar className="w-32" />
          </span>
          <span className="text-[11px] leading-snug">
            <SkeletonBar className="w-24" />
          </span>
        </div>
      </div>
    );
  }

  if (!searchLocation) {
    return (
      <button
        type="button"
        onClick={() => setMobileSearchOpen(true)}
        aria-label="Search"
        className="flex-1 flex items-center justify-center gap-2 rounded-full border border-surface-border bg-white px-4 py-3 shadow-card active:scale-[0.99] transition-transform"
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
        <span className="text-[14px] text-ink font-medium content-resolved">Start your search</span>
      </button>
    );
  }

  return (
    <div className="flex-1 flex items-center rounded-full border border-surface-border bg-white shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setMobileSearchOpen(true)}
        className="flex-1 min-w-0 flex flex-col items-center justify-center text-center px-4 py-2.5"
      >
        <span className="text-[13px] font-semibold text-ink leading-snug truncate w-full text-center content-resolved">
          {searchLocation}
        </span>
        <span className="text-[11px] text-ink-muted leading-snug content-resolved">{summary}</span>
      </button>
    </div>
  );
}
