'use client';

import { Amenity, PropertyType, SearchFilters } from '@/lib/types';
import { useState } from 'react';

const PROPERTY_TYPES: PropertyType[] = [
  'Single Family',
  'Condo',
  'Townhome',
  'Multi-Family',
  'Loft',
  'New Construction',
];
const AMENITIES: Amenity[] = [
  'Pool',
  'Garage',
  'Gym',
  'Elevator',
  'Balcony',
  'Fireplace',
  'Washer/Dryer',
  'Pet Friendly',
  'Waterfront',
  'Office',
  'Rooftop',
  'Garden',
  'Smart Home',
  'Solar',
  'EV Charging',
];

interface Props {
  filters: SearchFilters;
  onChange: (f: SearchFilters) => void;
}

export default function FilterPanel({ filters, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const toggleAmenity = (a: Amenity) => {
    const current = filters.amenities || [];
    set({ amenities: current.includes(a) ? current.filter((x) => x !== a) : [...current, a] });
  };

  return (
    <div className="rounded-md border border-surface-border bg-white p-5 shadow-card">
      {/* Listing type — segmented control */}
      <div className="inline-flex w-full rounded-full bg-surface-alt p-1">
        {(['all', 'sale', 'rent'] as const).map((t) => {
          const active = (filters.listingType || 'all') === t;
          return (
            <button
              key={t}
              onClick={() => set({ listingType: t })}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                active ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t === 'all' ? 'All' : t === 'sale' ? 'Buy' : 'Rent'}
            </button>
          );
        })}
      </div>

      {/* Price range */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Min Price</label>
          <input
            type="number"
            className="input-field"
            placeholder="No min"
            value={filters.minPrice ?? ''}
            onChange={(e) => set({ minPrice: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Max Price</label>
          <input
            type="number"
            className="input-field"
            placeholder="No max"
            value={filters.maxPrice ?? ''}
            onChange={(e) => set({ maxPrice: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </div>

      {/* Beds / Baths */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Beds</label>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => set({ beds: n })}
                className={`flex-1 rounded-sm py-2 text-xs font-medium transition ${
                  (filters.beds ?? 0) === n
                    ? 'bg-brand text-white'
                    : 'bg-surface-alt text-ink-muted hover:text-ink'
                }`}
              >
                {n === 0 ? 'Any' : `${n}+`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Baths</label>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => set({ baths: n })}
                className={`flex-1 rounded-sm py-2 text-xs font-medium transition ${
                  (filters.baths ?? 0) === n
                    ? 'bg-brand text-white'
                    : 'bg-surface-alt text-ink-muted hover:text-ink'
                }`}
              >
                {n === 0 ? 'Any' : `${n}+`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Property type */}
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-ink-muted">Property Type</label>
        <select
          className="input-field"
          value={filters.propertyType ?? 'all'}
          onChange={(e) =>
            set({
              propertyType: e.target.value === 'all' ? undefined : (e.target.value as PropertyType),
            })
          }
        >
          <option value="all">All Types</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Toggle filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { key: 'openHouse' as const, label: 'Open House' },
          { key: 'newConstruction' as const, label: 'New Build' },
          { key: 'waterfront' as const, label: 'Waterfront' },
          { key: 'petFriendly' as const, label: 'Pet Friendly' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => set({ [key]: !filters[key] })}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              filters[key]
                ? 'border-brand bg-brand-50 text-brand-700'
                : 'border-surface-border text-ink-muted hover:border-ink-subtle'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* More / Amenities */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-4 text-sm font-medium text-brand hover:underline"
      >
        {expanded ? 'Show less' : 'More filters & amenities'}
      </button>

      {expanded && (
        <div className="mt-3">
          <label className="mb-2 block text-xs font-medium text-ink-muted">Amenities</label>
          <div className="flex flex-wrap gap-2">
            {AMENITIES.map((a) => (
              <button
                key={a}
                onClick={() => toggleAmenity(a)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  filters.amenities?.includes(a)
                    ? 'border-brand bg-brand-50 text-brand-700'
                    : 'border-surface-border text-ink-muted hover:border-ink-subtle'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          {/* Sqft */}
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-ink-muted">Min Sqft</label>
            <input
              type="number"
              className="input-field"
              placeholder="No min"
              value={filters.minSqft ?? ''}
              onChange={(e) =>
                set({ minSqft: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
        </div>
      )}

      {/* Sort */}
      <div className="mt-4 border-t border-surface-border pt-4">
        <select
          className="input-field"
          value={filters.sort ?? 'recommended'}
          onChange={(e) => set({ sort: e.target.value as SearchFilters['sort'] })}
        >
          <option value="recommended">Recommended</option>
          <option value="newest">Newest</option>
          <option value="price-asc">Price: Low → High</option>
          <option value="price-desc">Price: High → Low</option>
        </select>
      </div>
    </div>
  );
}
