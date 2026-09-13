'use client';

import { useEffect, useState } from 'react';
import type { SearchFilters } from '@/lib/types';
import FilterModalContent from '@/components/FilterModalContent';
import { applyLandInterlock, filtersToSearchParams } from '@/lib/listing-filters';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  resultCount: number;
}

/**
 * The parameters the search bar owns, not the filter modal.
 *
 * "Clear all" clears *filters*; it does not throw away the place the user searched for or the
 * order they asked results in. Clearing `q` would empty the search bar and swap a local search for
 * a nationwide one, which is not what the button says it does.
 */
const PRESERVED_ON_CLEAR = ['query', 'zip', 'street', 'neighborhood', 'sort'] as const;

/**
 * How many filters the badge on the Filters button reports.
 *
 * Counts exactly what the live surface can set — no more. It used to count `waterfront` and
 * `petFriendly` as separate filters, which were folded onto their amenity equivalents, and to
 * treat `beds: 0` as active. A badge that says "3" when the modal shows one thing selected is a
 * second, quieter version of the same bug this ticket closes.
 *
 * Amenities count individually because each is an independent narrowing the user chose.
 */
export function countActiveFilters(filters: SearchFilters): number {
  let n = 0;
  if (filters.listingType && filters.listingType !== 'all') n++;
  if (filters.propertyType && filters.propertyType !== 'all') n++;
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) n++;
  if (filters.beds !== undefined && filters.beds > 0) n++;
  if (filters.baths !== undefined && filters.baths > 0) n++;
  if (filters.minSqft !== undefined && filters.minSqft > 0) n++;
  if (filters.openHouse) n++;
  if (filters.newConstruction) n++;
  n += filters.amenities?.length ?? 0;
  return n;
}

/** True when two filter sets would produce the same request — compared by their URL form. */
function sameFilters(a: SearchFilters, b: SearchFilters): boolean {
  const key = (filters: SearchFilters) => {
    const params = filtersToSearchParams(filters);
    params.sort();
    return params.toString();
  };
  return key(a) === key(b);
}

export default function FilterModal({ isOpen, onClose, filters, onChange, resultCount }: Props) {
  /*
   * The draft the user is editing, seeded from what is currently applied.
   *
   * Reopening the modal therefore shows what is actually narrowing the results, which it never did
   * before: the body kept its own state, was never handed the applied filters, and so showed
   * defaults every time — telling the user nothing was filtered while the badge next to the button
   * said otherwise.
   *
   * A `useState` initialiser is enough because this component unmounts while closed (see the early
   * return below), so it re-seeds on every open with no effect and no stale-draft window.
   */
  const [draft, setDraft] = useState<SearchFilters>(filters);

  // Lock body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasFilters = countActiveFilters(draft) > 0;
  /** The result count on the button describes the applied search, so it is only true of a draft
   *  that has not diverged from it. */
  const countIsCurrent = sameFilters(draft, filters);

  const clearedDraft = (): SearchFilters => {
    const kept: SearchFilters = {};
    for (const key of PRESERVED_ON_CLEAR) {
      const value = draft[key];
      if (value !== undefined) Object.assign(kept, { [key]: value });
    }
    return kept;
  };

  const apply = (next: SearchFilters) => {
    onChange(next);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-dialog flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal card */}
      <div className="relative z-10 flex flex-col w-full sm:w-[95vw] sm:max-w-2xl max-h-[92dvh] rounded-t-3xl sm:rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
          {/* Spacer to keep title centered */}
          <div className="h-8 w-8" />
          <h2 className="font-semibold text-[15px] text-ink">Filters</h2>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-alt transition shrink-0"
          >
            <svg
              className="h-4 w-4 text-ink"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6">
          <FilterModalContent
            value={draft}
            // The Lot/Land interlock is applied on every draft edit rather than in an effect, so it
            // converges in a single pass: picking Land clears beds/baths/min-sqft in the same
            // update that sets the home type.
            onChange={(next) => setDraft(applyLandInterlock(next))}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border shrink-0 bg-white">
          <button
            onClick={() => setDraft(clearedDraft())}
            disabled={!hasFilters}
            className={`text-sm font-semibold underline-offset-2 transition ${
              hasFilters ? 'text-ink underline hover:text-ink/60' : 'text-ink-muted cursor-default'
            }`}
          >
            Clear all
          </button>
          <button
            onClick={() => apply(draft)}
            className="rounded-xl bg-ink px-6 py-3 text-sm font-bold text-white hover:bg-ink/85 active:scale-[0.98] transition"
          >
            {countIsCurrent
              ? `Show ${resultCount.toLocaleString()} home${resultCount !== 1 ? 's' : ''}`
              : 'Show homes'}
          </button>
        </div>
      </div>
    </div>
  );
}
