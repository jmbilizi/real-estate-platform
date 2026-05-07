"use client";

import { useEffect } from "react";
import type { SearchFilters } from "@/lib/types";
import FilterModalContent from "@/components/FilterModalContent";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
  resultCount: number;
}

export function countActiveFilters(filters: SearchFilters): number {
  let n = 0;
  if (filters.listingType && filters.listingType !== "all") n++;
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) n++;
  if (filters.beds && filters.beds > 0) n++;
  if (filters.baths && filters.baths > 0) n++;
  if (filters.propertyType && filters.propertyType !== "all") n++;
  if (filters.openHouse) n++;
  if (filters.newConstruction) n++;
  if (filters.waterfront) n++;
  if (filters.petFriendly) n++;
  if (filters.amenities && filters.amenities.length > 0) n += filters.amenities.length;
  if (filters.minSqft !== undefined) n++;
  return n;
}

export default function FilterModal({ isOpen, onClose, filters, onChange, resultCount }: Props) {
  // Lock body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasFilters = countActiveFilters(filters) > 0;

  const clearAll = () =>
    onChange({
      query: filters.query,
      zip: filters.zip,
      street: filters.street,
      sort: filters.sort,
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
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
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-alt transition"
          >
            <svg className="h-4 w-4 text-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h2 className="font-semibold text-[15px] text-ink">Filters</h2>
          {/* Spacer to balance the close button */}
          <div className="h-8 w-8" />
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6">
          <FilterModalContent onClear={clearAll} onShow={onClose} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border shrink-0 bg-white">
          <button
            onClick={clearAll}
            disabled={!hasFilters}
            className={`text-sm font-semibold underline-offset-2 transition ${
              hasFilters ? "text-ink underline hover:text-ink/60" : "text-ink-muted cursor-default"
            }`}
          >
            Clear all
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-ink px-6 py-3 text-sm font-bold text-white hover:bg-ink/85 active:scale-[0.98] transition"
          >
            Show {resultCount.toLocaleString()} home{resultCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
