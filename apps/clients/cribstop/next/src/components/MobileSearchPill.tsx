'use client';

import { useApp } from '@/lib/context';

/**
 * Shared mobile search pill used in both ScrollSentinel (in-page, pre-scroll)
 * and NavBar (overlay, post-scroll). Reads everything from context so both
 * places always display the same content.
 *
 * The caller is responsible for the outer container / positioning wrapper.
 */
export default function MobileSearchPill() {
  const {
    searchLocation,
    listingType,
    activeTab,
    searchDateRange,
    searchOccupants,
    setMobileSearchOpen,
  } = useApp();

  const summary = (() => {
    if (activeTab === 'services') return 'Find services';
    if (activeTab === 'connect') return 'Explore connect';
    const parts: string[] = [];
    parts.push(listingType === 'rent' ? 'For Rent' : 'For Sale');
    const { start, end, flexibility } = searchDateRange;
    if (start) {
      const mo = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const fmt = (ds: string) => {
        const [, m, d] = ds.split('-');
        return `${mo[parseInt(m) - 1]} ${parseInt(d)}`;
      };
      const flexSuffix: Record<string, string> = {
        '1': '±1d',
        '3': '±3d',
        '7': '±1wk',
        '14': '±2wk',
        '30': '±1mo',
        '60': '±2mo',
        '90': '±3mo',
        '180': '±6mo',
        '365': '±1yr',
        '730': '±2yr',
      };
      const base = end && end !== start ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
      const suf =
        flexibility && flexibility !== 'exact' && (!end || end === start)
          ? flexSuffix[flexibility]
          : '';
      parts.push(suf ? `${base} ${suf}` : base);
    } else if (flexibility && flexibility !== 'exact') {
      const flexLabelMap: Record<string, string> = {
        '1': '± 1 day',
        '3': '± 3 days',
        '7': '± 1 week',
        '14': '± 2 weeks',
        '30': '± 1 month',
        '60': '± 2 months',
        '90': '± 3 months',
        '180': '± 6 months',
        '365': '± 1 year',
        '730': '± 2 years',
      };
      parts.push(flexLabelMap[flexibility] ?? 'Flexible');
    } else {
      parts.push('Any dates');
    }
    const total = searchOccupants.adults + searchOccupants.children;
    if (total > 0) parts.push(`${total} occupant${total !== 1 ? 's' : ''}`);
    return parts.join(' · ');
  })();

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
        <span className="text-[14px] text-ink font-medium">Start your search</span>
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
        <span className="text-[13px] font-semibold text-ink leading-snug truncate w-full text-center">
          {searchLocation}
        </span>
        <span className="text-[11px] text-ink-muted leading-snug">{summary}</span>
      </button>
    </div>
  );
}
