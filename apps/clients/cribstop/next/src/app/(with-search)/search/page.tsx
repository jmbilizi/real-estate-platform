'use client';

import { Suspense, useEffect, useState } from 'react';
import ListingCard from '@/components/ListingCard';
import ListingsMap from '@/components/ListingsMap';
import listings from '@/lib/listings';
import { useApp } from '@/lib/context';

import { applyFilters } from '@/lib/filters';
import type { SearchFilters } from '@/lib/types';
import SortDropdown from '@/components/SortDropdown';
import FilterModal, { countActiveFilters } from '@/components/FilterModal';

function parseFiltersFromUrl(): SearchFilters {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const filters: SearchFilters = {};
  if (params.get('q')) filters.query = params.get('q')!;
  if (params.get('zip')) filters.zip = params.get('zip')!;
  if (params.get('street')) filters.street = params.get('street')!;
  if (params.get('type') && params.get('type') !== 'all')
    filters.listingType = params.get('type') as any;
  if (params.get('minPrice')) filters.minPrice = Number(params.get('minPrice'));
  if (params.get('maxPrice')) filters.maxPrice = Number(params.get('maxPrice'));
  if (params.get('beds')) filters.beds = Number(params.get('beds'));
  if (params.get('baths')) filters.baths = Number(params.get('baths'));
  if (params.get('sort')) filters.sort = params.get('sort') as any;
  // Add more params as needed
  return filters;
}

function SearchContent() {
  const {
    savedIds,
    searchLocation: location,
    setSearchLocation: setLocation,
    setSearchSuggestion,
  } = useApp();
  // Sync context location from URL on mount and navigation
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const updateFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('q') || '';
        const lat = params.get('lat');
        const lon = params.get('lon');
        setLocation(q);
        // Restore the suggestion object so CompactSearchBar can search again without re-typing
        if (q && lat && lon) {
          setSearchSuggestion({ display_name: q, lat, lon });
        } else if (!q) {
          setSearchSuggestion(null);
        }
        setFilters(parseFiltersFromUrl());
      };
      updateFromUrl();
      window.addEventListener('popstate', updateFromUrl);
      window.addEventListener('pushstate', updateFromUrl);
      window.addEventListener('replacestate', updateFromUrl);
      return () => {
        window.removeEventListener('popstate', updateFromUrl);
        window.removeEventListener('pushstate', updateFromUrl);
        window.removeEventListener('replacestate', updateFromUrl);
      };
    }
  }, []);
  // Track hovered property for map highlight
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Map center for search location (lat/lng)
  const [searchCenter, setSearchCenter] = useState<[number, number] | null>(null);
  // Boundary polygon GeoJSON for the searched area
  const [searchPolygon, setSearchPolygon] = useState<object | null>(null);

  // Filters state — initialized empty; useEffect above populates from URL after mount
  const [filters, setFilters] = useState<SearchFilters>({});
  // Two-phase geocode:
  //   Phase 1 — no polygon, ~300 bytes → sets map center immediately so tiles load fast
  //   Phase 2 — same query with polygon_geojson + aggressive simplification (~5-15 KB)
  //             fires in parallel to tile loading, boundary appears ~500ms later
  useEffect(() => {
    // Clear stale state immediately so old boundary/center don't linger
    setSearchCenter(null);
    setSearchPolygon(null);
    if (!location || !location.trim()) return;
    let cancelled = false;
    const zip = (location.match(/\b(\d{5})\b/) ?? [])[1];

    // Both requests fire immediately — phase 1 just resolves first (no polygon payload)
    const base = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us';
    const qParam = zip
      ? `postalcode=${zip}` // exact zip boundary, not the city that contains it
      : `q=${encodeURIComponent(location)}`;

    // Phase 1: center only
    const centerUrl = `${base}&${qParam}`;
    // Phase 2: same query + simplified polygon (polygon_threshold removes ~85% of vertices)
    const polyUrl = `${base}&${qParam}&polygon_geojson=1&polygon_threshold=0.005`;

    fetch(centerUrl)
      .then((r) => r.json())
      .then((data: Array<{ lat: string; lon: string }>) => {
        if (cancelled || !Array.isArray(data) || !data.length) return;
        setSearchCenter([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
      })
      .catch(() => {
        if (!cancelled) setSearchCenter(null);
      });

    fetch(polyUrl)
      .then((r) => r.json())
      .then((data: Array<{ geojson?: { type: string }; boundingbox?: string[] }>) => {
        if (cancelled || !Array.isArray(data) || !data.length) {
          if (!cancelled) setSearchPolygon(null);
          return;
        }
        const geo = data[0].geojson;

        if (geo?.type === 'Polygon' || geo?.type === 'MultiPolygon') {
          // Real OSM boundary relation — use as-is (cities, counties, neighbourhoods)
          setSearchPolygon(geo as object);
        } else if (zip) {
          // Zip codes are synthetic points in OSM — fetch the real ZCTA polygon from
          // the US Census TIGER/Web service (proxied through our API to handle CORS).
          if (cancelled) return;
          fetch(`/api/zcta?zip=${zip}`)
            .then((r) => r.json())
            .then((fc: { features?: Array<{ geometry?: { type: string } }> }) => {
              if (cancelled) return;
              const geom = fc.features?.[0]?.geometry;
              if (geom?.type === 'Polygon' || geom?.type === 'MultiPolygon') {
                setSearchPolygon(geom as object);
              } else {
                setSearchPolygon(null);
              }
            })
            .catch(() => {
              if (!cancelled) setSearchPolygon(null);
            });
        } else {
          setSearchPolygon(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSearchPolygon(null);
      });

    return () => {
      cancelled = true;
    };
  }, [location]);

  // Filter modal open state
  const [filterOpen, setFilterOpen] = useState(false);

  // Sort state
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  // Apply filters to listings
  const filtered = applyFilters(listings, filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedResults = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const heading = 'Search results';

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="sticky top-[65px] z-20 bg-white border-b border-surface-border">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 sm:px-10 lg:px-20">
          <div>
            <h1 className="font-display text-lg font-extrabold tracking-tight sm:text-xl">
              {heading}
            </h1>
            <p className="text-xs text-ink-muted">
              <span className="font-semibold text-ink">{filtered.length}</span> home
              {filtered.length !== 1 ? 's' : ''} · DC · MD · VA
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 relative">
            {/* Filters pill button — Airbnb style */}
            <button
              onClick={() => setFilterOpen(true)}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition hover:shadow-sm active:scale-[0.98] ${
                countActiveFilters(filters) > 0
                  ? 'border-ink bg-ink/5 text-ink'
                  : 'border-surface-border bg-white text-ink hover:border-ink/40'
              }`}
              aria-label="Open filters"
            >
              <svg
                className="h-4 w-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <circle cx="17" cy="7" r="2" />
                <circle cx="7" cy="12" r="2" />
                <circle cx="17" cy="17" r="2" />
                <line x1="3" y1="7" x2="15" y2="7" />
                <line x1="9" y1="12" x2="21" y2="12" />
                <line x1="3" y1="17" x2="15" y2="17" />
              </svg>
              Filters
              {countActiveFilters(filters) > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
                  {countActiveFilters(filters)}
                </span>
              )}
            </button>

            <label htmlFor="sort" className="text-xs font-medium text-ink-muted">
              Sort By
            </label>
            <SortDropdown
              value={filters.sort || 'recommended'}
              onChange={(v) => {
                if (!v) return;
                setFilters((prev) => ({ ...prev, sort: v }));
                const params = new URLSearchParams(window.location.search);
                params.set('sort', String(v));
                window.history.pushState(
                  {},
                  '',
                  `${window.location.pathname}?${params.toString()}`,
                );
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* Filter modal */}
      <FilterModal
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
        resultCount={filtered.length}
      />

      {/* Body: Airbnb-style split layout.
           Desktop  — map fills right half edge-to-edge, full viewport height.
           Mobile   — map is sticky behind property cards; white rounded card
                      slides up over the map as the user scrolls (Airbnb feel).
           Technique: on mobile the map column is `position:absolute` spanning
           the full parent height, which gives `position:sticky` a tall enough
           parent to remain pinned while cards scroll over it. */}
      <div className="relative flex flex-col md:flex-row">
        {/* ── Map column ────────────────────────────────────────────────────
            Mobile  : absolute, fills parent so sticky has room to hold.
            Desktop : normal right-half column, edge-to-edge (no padding). ── */}
        <div
          className="absolute inset-0 z-0
                     md:relative md:inset-auto md:order-last md:w-[52%]"
        >
          <div className="sticky top-[133px] h-[45vh] md:h-[calc(100vh-133px)] md:py-6 md:pl-3 md:pr-10 lg:pl-5 lg:pr-20">
            <ListingsMap
              listings={pagedResults}
              savedIds={savedIds}
              activeId={hoveredId}
              className="h-full w-full md:rounded-2xl"
              searchCenter={searchCenter}
              searchPolygon={searchPolygon}
            />
          </div>
        </div>

        {/* ── Properties column ─────────────────────────────────────────────
            Mobile  : margin-top pushes it just below the map with a 2 rem
                      overlap; rounded white sheet slides over map on scroll.
            Desktop : left half, horizontal padding mirrors the toolbar. ── */}
        <div
          className="relative z-10 mt-[calc(45vh-2rem)]
                     rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.10)]
                     md:order-first md:w-[48%] md:mt-0 md:rounded-none
                     md:shadow-none md:z-auto
                     md:py-6 md:pl-10 md:pr-3 lg:pl-20 lg:pr-5"
        >
          {/* Drag handle — visible on mobile only */}
          <div className="flex justify-center pt-3 pb-1 md:hidden" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>

          <div className="px-5 pb-10 md:px-0 md:pb-0">
            {pagedResults.length === 0 ? (
              <EmptyState onClear={() => window.location.reload()} />
            ) : (
              <>
                <div className="grid gap-8 gap-y-12 grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3">
                  {pagedResults.map((l) => (
                    <div
                      key={l.id}
                      onMouseEnter={() => setHoveredId(l.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <ListingCard listing={l} />
                    </div>
                  ))}
                </div>
                {pageCount > 1 && (
                  <div className="flex justify-center mt-10">
                    <nav className="inline-flex items-center gap-1 rounded-full bg-white/90 px-4 py-2 shadow-lg border border-surface-border">
                      <button
                        className="px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        aria-label="Previous page"
                      >
                        &lt;
                      </button>
                      {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) =>
                        p === 1 || p === pageCount || Math.abs(p - page) <= 2 ? (
                          <button
                            key={p}
                            className={`px-3 py-1.5 rounded-full font-semibold transition ${
                              p === page
                                ? 'bg-ink text-white shadow'
                                : 'text-ink-muted hover:text-ink'
                            }`}
                            onClick={() => setPage(p)}
                            aria-current={p === page ? 'page' : undefined}
                          >
                            {p}
                          </button>
                        ) : (p === page - 3 || p === page + 3) && pageCount > 7 ? (
                          <span key={p} className="px-2 text-ink-muted">
                            …
                          </span>
                        ) : null,
                      )}
                      <button
                        className="px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                        onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                        disabled={page === pageCount}
                        aria-label="Next page"
                      >
                        &gt;
                      </button>
                    </nav>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-surface-border bg-surface-alt/60 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
        <svg
          className="h-7 w-7 text-ink-muted"
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
      </div>
      <p className="mt-5 font-display text-xl font-bold">No homes match your filters</p>
      <p className="mt-1 text-sm text-ink-muted">
        Try widening your price range or removing a filter.
      </p>
      <button onClick={onClear} className="btn-primary mt-5 text-sm">
        Clear all filters
      </button>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24 text-ink-muted">Loading search…</div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
