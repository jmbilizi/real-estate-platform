'use client';

import { useApp } from '@/lib/context';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

type ActiveField = 'where' | 'type' | 'when' | 'who' | null;

export default function SearchBarHomes({ onDone }: { onDone?: () => void }) {
  const {
    searchLocation,
    setSearchLocation,
    listingType,
    setListingType,
    searchDateRange,
    searchOccupants,
  } = useApp();
  const router = useRouter();
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    if (!activeField) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setActiveField(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeField]);

  const totalOccupants =
    searchOccupants.adults +
    searchOccupants.seniors +
    searchOccupants.teens +
    searchOccupants.children +
    searchOccupants.infants;

  const whenLabel = (() => {
    if (searchDateRange.start) {
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
      if (searchDateRange.end && searchDateRange.end !== searchDateRange.start) {
        return `${fmt(searchDateRange.start)} – ${fmt(searchDateRange.end)}`;
      }
      return fmt(searchDateRange.start);
    }
    return 'Move-in date';
  })();

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (searchLocation) params.set('q', searchLocation);
    params.set('listingType', listingType);
    router.push(`/search?${params.toString()}`);
    setActiveField(null);
    onDone?.();
  };

  return (
    <div ref={barRef} className="relative w-full max-w-[720px] mx-auto">
      {/* Segmented search bar */}
      <div className="flex items-center rounded-full border border-surface-border bg-surface-alt shadow-sm hover:shadow-md transition-shadow">
        {/* Where */}
        <button
          onClick={() => setActiveField(activeField === 'where' ? null : 'where')}
          className={`flex-1 min-w-0 px-5 py-3.5 rounded-full text-left transition-colors ${
            activeField === 'where'
              ? 'bg-white shadow-md'
              : activeField
                ? 'hover:bg-surface-soft'
                : 'hover:bg-surface-soft'
          }`}
        >
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">Where</p>
          <p className={`text-sm truncate ${searchLocation ? 'text-ink' : 'text-ink-muted'}`}>
            {searchLocation || 'Search locations'}
          </p>
        </button>

        <div className="w-px h-8 bg-surface-border" />

        {/* Type (For Sale / For Rent) */}
        <button
          onClick={() => setActiveField(activeField === 'type' ? null : 'type')}
          className={`px-4 py-3.5 rounded-full text-left transition-colors whitespace-nowrap ${
            activeField === 'type' ? 'bg-white shadow-md' : 'hover:bg-surface-soft'
          }`}
        >
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">Type</p>
          <p className="text-sm text-ink flex items-center gap-1">
            {listingType === 'sale' ? 'For Sale' : 'For Rent'}
            <ChevronDown className="h-3 w-3 text-ink-muted" />
          </p>
        </button>

        <div className="w-px h-8 bg-surface-border" />

        {/* When */}
        <button
          onClick={() => setActiveField(activeField === 'when' ? null : 'when')}
          className={`flex-1 min-w-0 px-4 py-3.5 rounded-full text-left transition-colors ${
            activeField === 'when' ? 'bg-white shadow-md' : 'hover:bg-surface-soft'
          }`}
        >
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">When</p>
          <p
            className={`text-sm truncate ${searchDateRange.start ? 'text-ink' : 'text-ink-muted'}`}
          >
            {whenLabel}
          </p>
        </button>

        <div className="w-px h-8 bg-surface-border" />

        {/* Who */}
        <button
          onClick={() => setActiveField(activeField === 'who' ? null : 'who')}
          className={`px-4 py-3.5 rounded-full text-left transition-colors whitespace-nowrap ${
            activeField === 'who' ? 'bg-white shadow-md' : 'hover:bg-surface-soft'
          }`}
        >
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">Who</p>
          <p className={`text-sm ${totalOccupants ? 'text-ink' : 'text-ink-muted'}`}>
            {totalOccupants
              ? `${totalOccupants} guest${totalOccupants > 1 ? 's' : ''}`
              : 'Add guests'}
          </p>
        </button>

        {/* Search button */}
        <button
          onClick={handleSearch}
          className="flex-shrink-0 m-2 flex items-center justify-center h-10 w-10 rounded-full bg-brand text-white hover:bg-brand-700 transition-colors shadow-md"
          aria-label="Search"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* Dropdown panels */}
      <AnimatePresence>
        {activeField === 'where' && (
          <motion.div
            key="where-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full left-0 mt-3 w-full max-w-sm bg-white rounded-2xl shadow-xl border border-surface-border p-5 z-50"
          >
            <label className="text-xs font-semibold text-ink mb-2 block">Location</label>
            <input
              type="text"
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
              placeholder="City, neighborhood, ZIP..."
              className="w-full px-4 py-3 rounded-xl border border-surface-border text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              autoFocus
            />
          </motion.div>
        )}

        {activeField === 'type' && (
          <motion.div
            key="type-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full left-1/4 mt-3 w-56 bg-white rounded-2xl shadow-xl border border-surface-border p-3 z-50"
          >
            {(['sale', 'rent'] as const).map((type) => (
              <button
                key={type}
                onClick={() => {
                  setListingType(type);
                  setActiveField(null);
                }}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  listingType === type ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-surface-soft'
                }`}
              >
                {type === 'sale' ? 'For Sale' : 'For Rent'}
              </button>
            ))}
          </motion.div>
        )}

        {activeField === 'when' && (
          <motion.div
            key="when-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full right-1/4 mt-3 w-72 bg-white rounded-2xl shadow-xl border border-surface-border p-5 z-50"
          >
            <p className="text-xs font-semibold text-ink mb-2">Move-in timeline</p>
            <p className="text-sm text-ink-muted">
              {searchDateRange.start
                ? whenLabel
                : 'Use the calendar in the full search to set dates.'}
            </p>
            <button
              onClick={() => setActiveField(null)}
              className="mt-3 w-full py-2.5 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}

        {activeField === 'who' && (
          <motion.div
            key="who-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full right-0 mt-3 w-72 bg-white rounded-2xl shadow-xl border border-surface-border p-5 z-50"
          >
            <p className="text-xs font-semibold text-ink mb-3">Occupants</p>
            <p className="text-sm text-ink-muted">
              {totalOccupants
                ? `${totalOccupants} guest${totalOccupants > 1 ? 's' : ''}`
                : 'Configure occupants in the full search.'}
            </p>
            <button
              onClick={() => setActiveField(null)}
              className="mt-3 w-full py-2.5 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
