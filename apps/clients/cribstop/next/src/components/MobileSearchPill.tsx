'use client';

import { useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/context';
import { LISTING_TYPE_SUMMARY_LABELS } from '@/lib/listing-type-labels';
import { SkeletonBar } from './Skeleton';
import { parseSearchPath } from '@cribstop/property-contracts';

/** The "Where" label, shown as the placeholder. The same text as the desktop header field. */
const WHERE_PLACEHOLDER = 'Where?';

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
   * One shape in every state, the same as the desktop header field: one line, with the "Where"
   * label as the placeholder. On a search path `SearchExperience` seeds `searchLocation` from the
   * URL in an effect, so the server does not know the location. The bar below stands in for it and
   * has the size of the text line, so nothing moves on hydration.
   */
  const pending = !hydrated && onSearchRoute;

  return (
    <button
      type="button"
      onClick={() => setMobileSearchOpen(true)}
      aria-label="Search"
      className="flex h-11 min-w-0 flex-1 items-center overflow-hidden rounded-full border border-surface-border bg-surface-alt text-left transition-transform active:scale-[0.99]"
    >
      <span className="flex h-full min-w-0 flex-1 items-center gap-2 pl-4 pr-2.5">
        {/* The icon gives its room to the place name once there is one: the row is narrow. */}
        {!searchLocation && (
          <svg
            aria-hidden="true"
            className="h-5 w-5 flex-shrink-0 text-ink-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        )}
        <span
          className={`min-w-0 flex-1 truncate text-[15px] leading-none ${
            searchLocation ? 'font-semibold text-ink' : 'text-ink-muted'
          }`}
        >
          {pending ? (
            <SkeletonBar className="w-28" />
          ) : (
            <span className="content-resolved">{searchLocation || WHERE_PLACEHOLDER}</span>
          )}
        </span>
      </span>
      {/* Below 390px the row has no room for the listing type beside the place: the sheet shows it. */}
      <span
        aria-hidden="true"
        className="h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] max-[389px]:hidden"
      />
      <span className="flex-shrink-0 whitespace-nowrap pl-2.5 pr-3.5 text-sm font-medium leading-none text-ink max-[389px]:hidden">
        {summary}
      </span>
    </button>
  );
}
