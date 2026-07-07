'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';

const SERVICE_CATEGORIES = [
  { id: 'agent', label: 'Real Estate Agent', icon: '🏠' },
  { id: 'mortgage', label: 'Mortgage Lender', icon: '🏦' },
  { id: 'inspector', label: 'Home Inspector', icon: '🔍' },
  { id: 'contractor', label: 'Contractor', icon: '🔨' },
  { id: 'mover', label: 'Moving Company', icon: '🚚' },
  { id: 'cleaner', label: 'Cleaning Service', icon: '✨' },
  { id: 'lawyer', label: 'Real Estate Attorney', icon: '⚖️' },
  { id: 'appraiser', label: 'Appraiser', icon: '📋' },
];

export default function SearchBarServices({ onDone }: { onDone?: () => void }) {
  const { searchLocation, setSearchLocation } = useApp();
  const router = useRouter();
  const [activeField, setActiveField] = useState<'what' | 'where' | null>(null);
  const [serviceType, setServiceType] = useState('');
  const barRef = useRef<HTMLDivElement>(null);

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

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (serviceType) params.set('type', serviceType);
    if (searchLocation) params.set('location', searchLocation);
    router.push(`/services?${params.toString()}`);
    setActiveField(null);
    onDone?.();
  };

  return (
    <div ref={barRef} className="relative w-full max-w-[560px] mx-auto">
      <div className="flex items-center rounded-full border border-surface-border bg-surface-alt shadow-sm hover:shadow-md transition-shadow">
        {/* What service */}
        <button
          onClick={() => setActiveField(activeField === 'what' ? null : 'what')}
          className={`flex-1 min-w-0 px-5 py-3.5 rounded-full text-left transition-colors ${
            activeField === 'what' ? 'bg-white shadow-md' : 'hover:bg-surface-soft'
          }`}
        >
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">What</p>
          <p className={`text-sm truncate ${serviceType ? 'text-ink' : 'text-ink-muted'}`}>
            {SERVICE_CATEGORIES.find((s) => s.id === serviceType)?.label || 'Service type'}
          </p>
        </button>

        <div className="w-px h-8 bg-surface-border" />

        {/* Where */}
        <button
          onClick={() => setActiveField(activeField === 'where' ? null : 'where')}
          className={`flex-1 min-w-0 px-5 py-3.5 rounded-full text-left transition-colors ${
            activeField === 'where' ? 'bg-white shadow-md' : 'hover:bg-surface-soft'
          }`}
        >
          <p className="text-[11px] font-semibold text-ink leading-none mb-0.5">Where</p>
          <p className={`text-sm truncate ${searchLocation ? 'text-ink' : 'text-ink-muted'}`}>
            {searchLocation || 'Search locations'}
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
        {activeField === 'what' && (
          <motion.div
            key="what-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full left-0 mt-3 w-72 bg-white rounded-2xl shadow-xl border border-surface-border p-2 z-50"
          >
            {SERVICE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setServiceType(cat.id);
                  setActiveField('where');
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                  serviceType === cat.id
                    ? 'bg-brand/10 text-brand font-medium'
                    : 'text-ink hover:bg-surface-soft'
                }`}
              >
                <span className="text-lg">{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </motion.div>
        )}

        {activeField === 'where' && (
          <motion.div
            key="where-panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full right-12 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-surface-border p-5 z-50"
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
      </AnimatePresence>
    </div>
  );
}
