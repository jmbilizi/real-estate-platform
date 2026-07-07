'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import {
  extractSearchTerms,
  fetchNearbyLocationsByType,
  formatLocationLabel,
  highlightMatch,
} from '@/lib/search-utils';
import { BED_OPTIONS, DateRangePanel, PRICE_RANGES } from './DateRangePanel';

export default function CompactSearchBar({
  headerMode = false,
  onPillClick,
  headerExpandedMode = false,
  onDone,
  mobileSheetMode = false,
  onClose,
}: {
  /** When true: renders the read-only 4-slot compact pill used by Header */
  headerMode?: boolean;
  /** Called when the compact pill is clicked (headerMode only) */
  onPillClick?: () => void;
  /** When true: renders the full interactive bar without section/padding wrapper */
  headerExpandedMode?: boolean;
  /** Called after a successful search when headerExpandedMode=true */
  onDone?: () => void;
  /** When true: renders a full-screen mobile search sheet (reuses all panels) */
  mobileSheetMode?: boolean;
  /** Called to close the mobile sheet */
  onClose?: () => void;
}) {
  const {
    listingTab: ctxTab,
    setListingTab,
    searchLocation,
    setSearchLocation,
    searchSuggestion,
    setSearchSuggestion,
    searchMoveInDate,
    setSearchMoveInDate,
    searchDateRange,
    setSearchDateRange,
    searchOccupants,
    setSearchOccupants,
    searchPriceIdx,
    searchBedsIdx,
  } = useApp();

  // Local aliases ? keep all existing JSX/logic unchanged
  const location = searchLocation;
  const setLocation = setSearchLocation;
  const selectedSuggestion = searchSuggestion;
  const setSelectedSuggestion = setSearchSuggestion;
  const _moveInDate = searchMoveInDate;
  const _setMoveInDate = setSearchMoveInDate;
  const dateRange = searchDateRange;
  const setDateRange = setSearchDateRange;
  // Local state for range-picking interaction (first click = start, second = end)
  const [rangePickStep, setRangePickStep] = useState<'start' | 'end'>('start');
  // hovered date for visual range preview
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const occupants = searchOccupants;
  const setOccupants = setSearchOccupants;
  const priceIdx = searchPriceIdx;
  const bedsIdx = searchBedsIdx;
  const listingTab = ctxTab;
  // State for nearby locations and loading
  const [nearbyLocations, setNearbyLocations] = useState<any[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [, setNearbyError] = useState<string | null>(null);
  // Cache last geolocated position and resolved place
  type LastGeo = { lat: number; lon: number; placeType: string; address: any };
  const [lastGeo, setLastGeo] = useState<LastGeo | null>(null);
  // Key ("lat,lon" at 5dp) for which nearbyLocations in state was last successfully fetched
  const nearbyForKey = useRef<string | null>(null);
  // AbortControllers — cancel in-flight requests when a new one starts or panel closes
  const nearbyAbortRef = useRef<AbortController | null>(null);
  const geoAbortRef = useRef<AbortController | null>(null);

  // Handler: Get nearby locations using input location if available, else geolocation
  const handleFetchNearbyLocations = async (forceGeo = false) => {
    // Cancel any previous in-flight nearby request
    nearbyAbortRef.current?.abort();
    const ac = new AbortController();
    nearbyAbortRef.current = ac;
    const signal = ac.signal;

    // Robust valid location logic
    let lat: number | null = null;
    let lon: number | null = null;
    let placeType: 'city' | 'town' | 'village' = 'city';
    let address: any = null;
    let refSuggestion = null;
    if (!forceGeo) {
      // 1. Use selected suggestion if available
      if (selectedSuggestion && selectedSuggestion.lat && selectedSuggestion.lon) {
        refSuggestion = selectedSuggestion;
      } else if (location && suggestions.length > 0) {
        // 2. If input matches a suggestion, use that
        refSuggestion =
          suggestions.find(
            (s) => formatLocationLabel(s).toLowerCase() === location.trim().toLowerCase(),
          ) || suggestions[0];
      }
      if (refSuggestion && refSuggestion.lat && refSuggestion.lon) {
        lat = Number(refSuggestion.lat);
        lon = Number(refSuggestion.lon);
        if (
          refSuggestion.type === 'city' ||
          refSuggestion.type === 'town' ||
          refSuggestion.type === 'village'
        ) {
          placeType = refSuggestion.type;
        }
        address = refSuggestion.address || null;
      }
      // If no valid location yet, try lastGeo (synchronous path only)
      if (lat == null || lon == null) {
        if (lastGeo && typeof lastGeo.lat === 'number' && typeof lastGeo.lon === 'number') {
          lat = lastGeo.lat;
          lon = lastGeo.lon;
          placeType = lastGeo.placeType as any;
          address = lastGeo.address;
        }
      }
    }
    // Early-exit: if we already have results for this exact position, do nothing
    if (lat != null && lon != null) {
      const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
      if (nearbyForKey.current === key && nearbyLocations.length > 0) return;
    }
    setNearbyError(null);
    setNearbyLocations([]);
    setLoadingNearby(true);
    // If still no lat/lon, fall back to geolocation API
    if (lat == null || lon == null) {
      if (typeof window !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (signal.aborted) return;
            const { latitude, longitude } = pos.coords;
            const geoKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
            // Early-exit if already have results for this GPS position
            if (nearbyForKey.current === geoKey && nearbyLocations.length > 0) {
              setLoadingNearby(false);
              return;
            }
            // Only call reverse geocode if position changed
            if (lastGeo && lastGeo.lat === latitude && lastGeo.lon === longitude) {
              lat = lastGeo.lat;
              lon = lastGeo.lon;
              placeType = lastGeo.placeType as any;
              address = lastGeo.address;
            } else {
              try {
                const resp = await fetch(
                  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
                  {
                    headers: {
                      Accept: 'application/json',
                      'User-Agent': 'real-estate-platform/1.0',
                    },
                    signal,
                  },
                );
                if (resp.ok) {
                  const data = await resp.json();
                  if (data && data.address) {
                    if (data.address.city) placeType = 'city';
                    else if (data.address.town) placeType = 'town';
                    else if (data.address.village) placeType = 'village';
                    address = data.address;
                    setLastGeo({ lat: latitude, lon: longitude, placeType, address });
                  }
                }
              } catch (e: any) {
                if (e?.name === 'AbortError') return;
                setNearbyError('Failed to determine your location type.');
                setLoadingNearby(false);
                return;
              }
              lat = latitude;
              lon = longitude;
            }
            if (typeof lat === 'number' && typeof lon === 'number') {
              try {
                const results = await fetchNearbyLocationsByType(
                  lat,
                  lon,
                  placeType,
                  20000,
                  signal,
                );
                const hintState = address?.state || address?.state_code || '';
                const enriched = await Promise.all(
                  results.map(async (loc) => {
                    try {
                      const resp = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=10&addressdetails=1`,
                        {
                          headers: {
                            Accept: 'application/json',
                            'User-Agent': 'real-estate-platform/1.0',
                          },
                          signal,
                        },
                      );
                      if (resp.ok) {
                        const data = await resp.json();
                        if (data && data.address) {
                          return { ...loc, address: data.address };
                        }
                      }
                    } catch (e: any) {
                      if (e?.name !== 'AbortError') console.error('[Nominatim] Enrich failed', e);
                    }
                    return { ...loc, _hint_state: hintState };
                  }),
                );
                if (signal.aborted) return;
                nearbyForKey.current = geoKey;
                setNearbyLocations(enriched);
                if (enriched.length === 0) setNearbyError('No nearby locations found.');
              } catch (e: any) {
                if (e?.name !== 'AbortError') setNearbyError('Failed to fetch nearby locations.');
              }
            }
            if (!signal.aborted) setLoadingNearby(false);
          },
          () => {
            if (signal.aborted) return;
            setNearbyError(
              'Could not get your current position. Please check browser permissions.',
            );
            setNearbyLocations([]);
            setLoadingNearby(false);
          },
        );
        return;
      } else {
        setNearbyError('Geolocation is not supported in this browser.');
        setNearbyLocations([]);
        setLoadingNearby(false);
        return;
      }
    }
    // If we have lat/lon from suggestion or lastGeo, fetch nearby
    if (typeof lat === 'number' && typeof lon === 'number') {
      const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
      try {
        const results = await fetchNearbyLocationsByType(lat, lon, placeType, 20000, signal);
        // Enrich each result with Nominatim reverse geocode for address
        const hintState = address?.state || address?.state_code || '';
        const enriched = await Promise.all(
          results.map(async (loc) => {
            try {
              const resp = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=10&addressdetails=1`,
                {
                  headers: { Accept: 'application/json', 'User-Agent': 'real-estate-platform/1.0' },
                  signal,
                },
              );
              if (resp.ok) {
                const data = await resp.json();
                if (data && data.address) {
                  return { ...loc, address: data.address };
                }
              }
            } catch (e: any) {
              if (e?.name !== 'AbortError') console.error('[Nominatim] Enrich failed', e);
            }
            return { ...loc, _hint_state: hintState };
          }),
        );
        if (signal.aborted) return;
        nearbyForKey.current = key;
        setNearbyLocations(enriched);
        if (enriched.length === 0) setNearbyError('No nearby locations found.');
      } catch (e: any) {
        if (e?.name !== 'AbortError') setNearbyError('Failed to fetch nearby locations.');
      }
    }
    if (!signal.aborted) setLoadingNearby(false);
  };
  const router = useRouter();
  // Location autocomplete state
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [isCommittedSelection, setIsCommittedSelection] = useState(false);
  const isCommittedSelectionRef = useRef(false);
  const [activePanel, setActivePanel] = useState<'where' | 'when' | 'who' | 'what' | null>(
    mobileSheetMode ? 'where' : null,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [whereShake, setWhereShake] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);

  // When a suggestion is already in context (e.g. restored from URL on navigation),
  // mark it as committed so handleSearch doesn't treat it as unresolved.
  useEffect(() => {
    if (selectedSuggestion) {
      isCommittedSelectionRef.current = true;
      setIsCommittedSelection(true);
    }
  }, [selectedSuggestion]);

  const whereRef = useRef<HTMLButtonElement>(null);
  const whenRef = useRef<HTMLButtonElement>(null);
  const whoRef = useRef<HTMLButtonElement>(null);
  const whatRef = useRef<HTMLButtonElement>(null);
  const searchBtnRef = useRef<HTMLDivElement>(null);
  const getIndicatorStyle = (): React.CSSProperties => {
    if (!activePanel) return {};
    const refs = { where: whereRef, when: whenRef, who: whoRef, what: whatRef };
    const btn = refs[activePanel]?.current;
    if (!btn) return {};
    if (activePanel === 'what' && searchBtnRef.current) {
      return { left: btn.offsetLeft, width: btn.offsetWidth + searchBtnRef.current.offsetWidth };
    }
    return { left: btn.offsetLeft, width: btn.offsetWidth };
  };
  const [calendarBaseMonth, setCalendarBaseMonth] = useState<{ year: number; month: number }>(
    () => {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() };
    },
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Load recent searches from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('recentSearches');
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    }
  }, []);

  // Save recent searches to localStorage
  const addRecentSearch = (item: any) => {
    if (!item) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s.display_name !== item.display_name);
      const updated = [item, ...filtered].slice(0, 5);
      if (typeof window !== 'undefined') {
        localStorage.setItem('recentSearches', JSON.stringify(updated));
      }
      return updated;
    });
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isDropdownOpen]);

  // Close activePanel when clicking outside the search bar
  useEffect(() => {
    if (!activePanel) return;
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setActivePanel(null);
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [activePanel]);

  // Close activePanel on searchbar:close event (fired during header transitions)
  useEffect(() => {
    function handleClose() {
      setActivePanel(null);
      setIsDropdownOpen(false);
    }
    window.addEventListener('searchbar:close', handleClose);
    return () => window.removeEventListener('searchbar:close', handleClose);
  }, []);

  // Mobile sheet mode: lock body scroll
  useEffect(() => {
    if (!mobileSheetMode) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileSheetMode]);

  // Mobile sheet mode: close on Escape
  useEffect(() => {
    if (!mobileSheetMode || !onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mobileSheetMode, onClose]);

  // Mobile sheet mode: auto-focus where input when where card is active
  useEffect(() => {
    if (!mobileSheetMode || activePanel !== 'where') return;
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [mobileSheetMode, activePanel]);

  // Mobile sheet mode: auto-close when viewport expands to sm (≥640px)
  useEffect(() => {
    if (!mobileSheetMode || !onClose) return;
    const mq = window.matchMedia('(min-width: 640px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) onClose();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mobileSheetMode, onClose]);

  // "What" description free-text
  const [description, setDescription] = useState('');
  const _whatSuggestionsRef = useRef<HTMLDivElement>(null);
  const whatHighlightRef = useRef<HTMLDivElement>(null);
  const whereHighlightRef = useRef<HTMLDivElement>(null);
  const whereHighlightRef2 = useRef<HTMLDivElement>(null);
  const whatHighlightRef2 = useRef<HTMLDivElement>(null);

  const SLIDE_TRANSITION =
    'top 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.12s';
  const FADE_ONLY_TRANSITION = 'opacity 0.12s';

  function applyHighlight(
    ref: React.RefObject<HTMLDivElement | null>,
    top: number,
    height: number,
  ) {
    const el = ref.current;
    if (!el) return;
    const isHidden = parseFloat(el.style.opacity || '0') < 0.5;
    if (isHidden) {
      // Snap to position instantly, then fade in — no sliding from nowhere
      el.style.transition = 'none';
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
      el.getBoundingClientRect(); // force reflow so browser paints position before transition re-enables
      el.style.transition = SLIDE_TRANSITION;
      el.style.opacity = '1';
    } else {
      // Already visible: slide smoothly to the new item
      el.style.transition = SLIDE_TRANSITION;
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
    }
  }
  function clearHighlight(ref: React.RefObject<HTMLDivElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.style.transition = FADE_ONLY_TRANSITION;
    el.style.opacity = '0';
  }

  function renderWhoPanel() {
    return (
      <div
        className="search-panel-enter absolute left-0 right-0 z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border"
        style={{ top: 'calc(100% + 6px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <p className="text-[13px] text-ink-muted mb-4">How many people will live here?</p>
          <div className="grid grid-cols-2 gap-x-8">
            {(
              [
                { key: 'seniors', label: 'Older adults', desc: 'Ages 55+' },
                { key: 'adults', label: 'Adults', desc: 'Ages 18–54' },
                { key: 'teens', label: 'Teens', desc: 'Ages 13–17' },
                { key: 'children', label: 'Children', desc: 'Ages 2–12' },
                { key: 'infants', label: 'Infants', desc: 'Under 2' },
                { key: 'pets', label: 'Pets', desc: 'Bringing pets?' },
              ] as const
            ).map(({ key, label, desc }, i) => (
              <div
                key={key}
                className={`flex items-center justify-between py-4 ${
                  i < 4 ? 'border-b border-surface-border' : ''
                }`}
              >
                <div>
                  <div className="font-semibold text-[15px]">{label}</div>
                  <div className="text-[13px] text-ink-muted">{desc}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={occupants[key] === 0}
                    onClick={() =>
                      setOccupants({ ...occupants, [key]: Math.max(0, occupants[key] - 1) })
                    }
                    className={`h-8 w-8 rounded-full border flex items-center justify-center text-lg transition-colors ${occupants[key] === 0 ? 'border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default' : 'border-[rgba(0,0,0,0.4)] text-ink hover:border-ink'}`}
                  >
                    -
                  </button>
                  <span className="w-4 text-center text-[15px] font-medium">{occupants[key]}</span>
                  <button
                    type="button"
                    onClick={() => setOccupants({ ...occupants, [key]: occupants[key] + 1 })}
                    className="h-8 w-8 rounded-full border border-[rgba(0,0,0,0.4)] flex items-center justify-center text-lg hover:border-ink transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              className="rounded-full bg-ink text-white px-6 py-2 text-sm font-semibold hover:bg-ink/90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderWhatPanelContent(highlightRef: React.RefObject<HTMLDivElement | null>) {
    return (
      <>
        {/* Listing type selector */}
        <p className="text-sm font-semibold text-ink mb-3">Listing type</p>
        <div className="flex gap-2 mb-5">
          {(['for-sale', 'for-rent'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setListingType(tab);
                setListingTab(tab);
              }}
              className={`flex-1 py-2.5 rounded-full text-sm font-semibold transition-colors duration-150 ${
                listingType === tab
                  ? 'bg-ink text-white shadow-sm'
                  : 'bg-surface-alt text-ink-muted hover:bg-[#e0e0e0]'
              }`}
            >
              {tab === 'for-sale' ? 'For Sale' : 'For Rent'}
            </button>
          ))}
        </div>

        {/* Description */}
        <p className="text-sm font-semibold text-ink mb-2">Description</p>
        <textarea
          autoFocus
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ask for specific things like a bright, modern kitchen and a yard."
          className="w-full resize-none rounded-xl border border-surface-border px-4 py-3 text-[15px] text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        {description && (
          <button
            type="button"
            onClick={() => setDescription('')}
            className="mt-1 text-xs font-semibold text-ink-muted hover:text-ink underline"
          >
            Clear
          </button>
        )}
        <p className="mt-4 mb-2 text-sm font-semibold text-brand">Suggested descriptions</p>
        <div
          className="relative flex flex-col gap-1"
          onMouseLeave={() => clearHighlight(highlightRef)}
        >
          <div
            ref={highlightRef}
            className="absolute inset-x-0 rounded-xl bg-surface-alt pointer-events-none"
            style={{ top: 0, height: 0, opacity: 0 }}
          />
          {(listingType === 'for-sale'
            ? SUGGESTED_DESCRIPTIONS_BUY
            : SUGGESTED_DESCRIPTIONS_RENT
          ).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setDescription(s);
                setActivePanel(null);
              }}
              onMouseEnter={(e) =>
                applyHighlight(
                  highlightRef,
                  e.currentTarget.offsetTop,
                  e.currentTarget.offsetHeight,
                )
              }
              className="relative z-[1] flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-ink transition"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#e8e8e8]">
                <svg
                  className="h-4 w-4 text-ink-muted"
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
              </span>
              {s}
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderWhatPanel(highlightRef: React.RefObject<HTMLDivElement | null>) {
    return (
      <div
        className="search-panel-enter absolute left-0 right-0 z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border"
        style={{ top: 'calc(100% + 6px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-5">{renderWhatPanelContent(highlightRef)}</div>
      </div>
    );
  }

  function renderWhenPanel() {
    return (
      <DateRangePanel
        dateRange={dateRange}
        setDateRange={setDateRange}
        rangePickStep={rangePickStep}
        setRangePickStep={setRangePickStep}
        hoveredDate={hoveredDate}
        setHoveredDate={setHoveredDate}
        calendarBaseMonth={calendarBaseMonth}
        setCalendarBaseMonth={setCalendarBaseMonth}
        onClose={() => setActivePanel(null)}
        listingType={listingType}
      />
    );
  }

  function renderWherePanel(highlightRef: React.RefObject<HTMLDivElement | null>) {
    return (
      <div
        className="search-panel-enter absolute left-0 right-0 z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border overflow-hidden"
        style={{ top: 'calc(100% + 6px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-4">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={location}
              autoComplete="off"
              placeholder="Search city, zip, neighborhood, or address"
              className="w-full rounded-full border border-surface-border px-5 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand/20 pr-10"
              onChange={(e) => {
                const val = e.target.value;
                isCommittedSelectionRef.current = false;
                setIsCommittedSelection(false);
                if (typeof setLocation === 'function') setLocation(val);
                setSelectedSuggestion(null);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                if (!val.trim() || val.trim().length < 2) {
                  setSuggestions([]);
                  setIsDropdownOpen(true);
                  return;
                }
                setLoadingSuggestions(true);
                debounceRef.current = setTimeout(async () => {
                  try {
                    const resp = await fetch(`/api/geocode?q=${encodeURIComponent(val)}`);
                    setSuggestions(resp.ok ? await resp.json() : []);
                  } catch {
                    setSuggestions([]);
                  } finally {
                    setLoadingSuggestions(false);
                    setIsDropdownOpen(true);
                  }
                }, 300);
              }}
              onFocus={async () => {
                setIsDropdownOpen(true);
                if (!location.trim()) await handleFetchNearbyLocations();
              }}
            />
            {location && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (typeof setLocation === 'function') setLocation('');
                  setSelectedSuggestion(null);
                  isCommittedSelectionRef.current = false;
                  setIsCommittedSelection(false);
                  setSuggestions([]);
                  inputRef.current?.focus({ preventScroll: true });
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                aria-label="Clear location"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div
          ref={dropdownRef}
          className="relative pb-3 max-h-72 overflow-y-auto"
          onMouseLeave={() => clearHighlight(highlightRef)}
        >
          <div
            ref={highlightRef}
            className="absolute inset-x-0 bg-[#f0f0f0] pointer-events-none"
            style={{ top: 0, height: 0, opacity: 0 }}
          />
          <hr className="border-t border-[#f0f0f0] mb-1" />
          {(location.trim().length < 2 || suggestions.length === 0) && (
            <button
              type="button"
              onMouseEnter={(e) =>
                applyHighlight(
                  highlightRef,
                  e.currentTarget.offsetTop,
                  e.currentTarget.offsetHeight,
                )
              }
              className="relative z-[1] flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
              onClick={async () => {
                await handleGeolocate();
                setActivePanel(null);
                setIsDropdownOpen(false);
              }}
            >
              <span className="inline-block w-5 h-5 text-brand flex-shrink-0">
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="#FF385C" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4" stroke="#FF385C" strokeWidth="2" />
                </svg>
              </span>
              <span className="font-medium text-[15px]">Use current location</span>
            </button>
          )}
          {location.trim().length >= 2 && loadingSuggestions && (
            <div className="px-5 py-3 text-ink-subtle text-sm">Loading?</div>
          )}
          {location.trim().length >= 2 && !loadingSuggestions && suggestions.length === 0 && (
            <div className="px-5 py-3 text-ink-subtle text-sm">No locations found</div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onMouseEnter={(e) =>
                applyHighlight(
                  highlightRef,
                  e.currentTarget.offsetTop,
                  e.currentTarget.offsetHeight,
                )
              }
              className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
              onClick={() => {
                setSelectedSuggestion(s);
                isCommittedSelectionRef.current = true;
                setIsCommittedSelection(true);
                if (typeof setLocation === 'function') setLocation(formatLocationLabel(s));
                setActivePanel(null);
                setIsDropdownOpen(false);
                addRecentSearch(s);
              }}
            >
              <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <path
                    d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="text-[15px] truncate">
                {highlightMatch(formatLocationLabel(s), location)}
              </span>
            </button>
          ))}
          {/* Nearby */}
          {(location.trim().length < 2 || suggestions.length === 0 || isCommittedSelection) &&
            (loadingNearby || nearbyLocations.length > 0) && (
              <>
                <hr className="border-t border-[#f0f0f0] my-1" />
                <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                  Nearby
                </div>
                {loadingNearby && (
                  <div className="px-5 py-2 text-ink-subtle text-sm">Loading nearby...</div>
                )}
                {!loadingNearby &&
                  nearbyLocations
                    .filter((loc) => {
                      if (!formatLocationLabel(loc)) return false;
                      const locLabel = formatLocationLabel(loc).toLowerCase();
                      if (
                        selectedSuggestion &&
                        loc.lat &&
                        loc.lon &&
                        selectedSuggestion.lat &&
                        selectedSuggestion.lon
                      ) {
                        if (
                          Number(loc.lat).toFixed(5) ===
                            Number(selectedSuggestion.lat).toFixed(5) &&
                          Number(loc.lon).toFixed(5) === Number(selectedSuggestion.lon).toFixed(5)
                        )
                          return false;
                      }
                      if (
                        selectedSuggestion &&
                        locLabel === formatLocationLabel(selectedSuggestion).toLowerCase()
                      )
                        return false;
                      return true;
                    })
                    .map((loc, idx) => (
                      <button
                        key={loc.display_name + idx}
                        type="button"
                        onMouseEnter={(e) =>
                          applyHighlight(
                            highlightRef,
                            e.currentTarget.offsetTop,
                            e.currentTarget.offsetHeight,
                          )
                        }
                        className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                        onClick={() => {
                          const formatted = formatLocationLabel(loc);
                          if (typeof setLocation === 'function') setLocation(formatted);
                          isCommittedSelectionRef.current = true;
                          setIsCommittedSelection(true);
                          setSelectedSuggestion({ ...loc, display_name: formatted });
                          setActivePanel(null);
                          setIsDropdownOpen(false);
                        }}
                      >
                        <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                          <svg viewBox="0 0 24 24" fill="none">
                            <path
                              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
                              fill="currentColor"
                            />
                          </svg>
                        </span>
                        <span className="text-[15px] truncate">
                          {highlightMatch(formatLocationLabel(loc), location)}
                        </span>
                      </button>
                    ))}
              </>
            )}
          {/* Recent searches */}
          {(location.trim().length < 2 || suggestions.length === 0 || isCommittedSelection) &&
            recentSearches.length > 0 && (
              <>
                <hr className="border-t border-[#f0f0f0] my-1" />
                <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                  Recent
                </div>
                {recentSearches.map((s, idx) => (
                  <div
                    key={s.display_name + idx}
                    onMouseEnter={(e) =>
                      applyHighlight(
                        highlightRef,
                        e.currentTarget.offsetTop,
                        e.currentTarget.offsetHeight,
                      )
                    }
                    className="relative z-[1] flex w-full items-center px-5 py-2.5 transition-colors group"
                  >
                    <button
                      type="button"
                      className="flex items-center flex-1 min-w-0 gap-3"
                      onClick={() => {
                        setSelectedSuggestion(s);
                        isCommittedSelectionRef.current = true;
                        setIsCommittedSelection(true);
                        if (typeof setLocation === 'function') setLocation(formatLocationLabel(s));
                        setActivePanel(null);
                        setIsDropdownOpen(false);
                      }}
                    >
                      <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                          <path
                            d="M17.01 14h-.8l-.27-.27c.98-1.14 1.57-2.61 1.57-4.23 0-3.59-2.91-6.5-6.5-6.5s-6.5 3-6.5 6.5H2l3.84 4 4.16-4H6.51C6.51 7 8.53 5 11.01 5s4.5 2.01 4.5 4.5c0 2.48-2.02 4.5-4.5 4.5-.65 0-1.26-.14-1.82-.38L7.71 15.1c.97.57 2.09.9 3.3.9 1.61 0 3.08-.59 4.22-1.57l.27.27v.79l5.01 4.99L22 19l-4.99-5z"
                            fill="currentColor"
                          />
                        </svg>
                      </span>
                      <span className="text-[15px] truncate">
                        {highlightMatch(formatLocationLabel(s), location)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Remove recent search"
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-surface-alt transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRecentSearches((prev) => {
                          const updated = prev.filter((_, i) => i !== idx);
                          if (typeof window !== 'undefined')
                            localStorage.setItem('recentSearches', JSON.stringify(updated));
                          return updated;
                        });
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                        <path
                          d="M5 5l8 8M13 5l-8 8"
                          stroke="#888"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </>
            )}
        </div>
      </div>
    );
  }

  const SUGGESTED_DESCRIPTIONS_BUY = [
    '3+ bedrooms, open-plan living, and a private backyard',
    'Modern kitchen, home office space, and a 2-car garage',
    'Quiet neighborhood, close to top-rated schools and commuter routes',
    'Move-in ready with updated HVAC, roof under 5 years, and no HOA',
  ];
  const SUGGESTED_DESCRIPTIONS_RENT = [
    '2+ bedrooms, in-unit laundry, and pet-friendly building',
    'Open-plan apartment with updated kitchen and parking included',
    'Furnished unit near transit, utilities included, flexible lease',
    'Spacious townhouse with private entrance and outdoor space',
  ];

  // listingType mirrors context listingTab with a local copy for optimistic tab switch animation
  const [listingType, setListingType] = useState<'for-sale' | 'for-rent'>(listingTab || 'for-sale');

  React.useEffect(() => {
    if (listingTab && listingTab !== listingType) setListingType(listingTab);
  }, [listingTab]);

  // Enhanced search: if location is empty, use geolocation; else require valid suggestion
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(location || '').trim()) {
      setIsSearching(true);
      setIsGeolocating(true);
      await handleGeolocate();
      setIsGeolocating(false);
      setIsSearching(false);
      return;
    }
    // If suggestions are still loading, open the where panel so user can see/wait
    if (loadingSuggestions) {
      setActivePanel('where');
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
      return;
    }
    // If user hasn't selected a suggestion, but suggestions exist, auto-select the first
    let finalSuggestion = selectedSuggestion;
    if (!selectedSuggestion && suggestions.length > 0) {
      finalSuggestion = suggestions[0];
      setSelectedSuggestion(finalSuggestion);
      isCommittedSelectionRef.current = true;
      setIsCommittedSelection(true);
      if (typeof setLocation === 'function') setLocation(formatLocationLabel(finalSuggestion));
    }
    if (!finalSuggestion) {
      // No valid location — open the where panel and shake it to prompt the user
      setActivePanel('where');
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
      setWhereShake(true);
      setTimeout(() => setWhereShake(false), 600);
      return;
    }
    // Use the selected/closest suggestion
    addRecentSearch(finalSuggestion);
    const label = formatLocationLabel(finalSuggestion);
    if (typeof setLocation === 'function') setLocation(label);
    const { zip, street } = extractSearchTerms(finalSuggestion);
    const params = new URLSearchParams();
    params.set('q', label);
    params.set('lat', finalSuggestion.lat);
    params.set('lon', finalSuggestion.lon);
    if (zip) params.set('zip', zip);
    if (street) params.set('street', street);
    const price = PRICE_RANGES[priceIdx];
    // (already reset at start of handler)
    if (price.min) params.set('minPrice', price.min);
    if (price.max) params.set('maxPrice', price.max);
    const beds = BED_OPTIONS[bedsIdx].value;
    if (beds) params.set('beds', beds);
    params.set('type', listingType);
    setIsSearching(true);
    router.push(`/search?${params.toString()}`);
    setIsDropdownOpen(false);
    setActivePanel(null);
    onDone?.();
  };

  // Always trigger geolocation and update location input
  const handleGeolocate = (): Promise<void> => {
    // Cancel any previous in-flight geolocate fetch
    geoAbortRef.current?.abort();
    const ac = new AbortController();
    geoAbortRef.current = ac;
    const signal = ac.signal;

    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            const { latitude, longitude } = pos.coords;
            (async () => {
              let displayName = `Current Location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
              try {
                const response = await fetch(
                  `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
                  {
                    headers: {
                      Accept: 'application/json',
                      'User-Agent': 'real-estate-platform/1.0',
                    },
                    signal,
                  },
                );
                // error handling is in the correct handler, not here
                if (response.ok) {
                  const data = await response.json();
                  if (data && data.address) {
                    // Compose 'City, State' if possible
                    // error handling is in the correct handler, not here
                    const city =
                      data.address.city || data.address.town || data.address.village || '';
                    // error handling is in the correct handler, not here
                    const state = data.address.state || data.address.state_code || '';
                    const parts = [];
                    if (city) parts.push(city);
                    if (state) parts.push(state);
                    const formatted = parts.join(', ');
                    // error handling is in the correct handler, not here
                    displayName = formatted || displayName;
                  }
                }
              } catch (e: any) {
                if (e?.name === 'AbortError') {
                  resolve();
                  return;
                }
              }
              if (signal.aborted) {
                resolve();
                return;
              }
              if (typeof setLocation === 'function') setLocation(displayName);
              const params = new URLSearchParams();
              params.set('q', displayName);
              const price = PRICE_RANGES[priceIdx];
              if (price.min) params.set('minPrice', price.min);
              if (price.max) params.set('maxPrice', price.max);
              const beds = BED_OPTIONS[bedsIdx].value;
              if (beds) params.set('beds', beds);
              params.set('type', listingType);
              router.push(`/search?${params.toString()}`);
              resolve();
            })();
          },
          (err) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            console.error('[Geolocation] Error getting current position:', err);
            alert(
              'Unable to get your current location. Please check your browser permissions and try again.',
            );
            if (typeof setLocation === 'function') setLocation('');
            const params = new URLSearchParams();
            params.set('q', '');
            const price = PRICE_RANGES[priceIdx];
            if (price.min) params.set('minPrice', price.min);
            if (price.max) params.set('maxPrice', price.max);
            const beds = BED_OPTIONS[bedsIdx].value;
            if (beds) params.set('beds', beds);
            params.set('type', listingType);
            router.push(`/search?${params.toString()}`);
            resolve();
          },
        );
      } else {
        alert('Geolocation is not supported in this browser.');
        if (typeof setLocation === 'function') setLocation('');
        const params = new URLSearchParams();
        params.set('q', '');
        const price = PRICE_RANGES[priceIdx];
        if (price.min) params.set('minPrice', price.min);
        if (price.max) params.set('maxPrice', price.max);
        const beds = BED_OPTIONS[bedsIdx].value;
        if (beds) params.set('beds', beds);
        params.set('type', listingType);
        router.push(`/search?${params.toString()}`);
        resolve();
      }
    });
  };

  // --- helpers (used in both render paths) ---------------------------------

  function occupantSummary(occ: {
    adults: number;
    seniors: number;
    teens: number;
    children: number;
    infants: number;
    pets: number;
  }): string {
    const total = occ.adults + occ.seniors + occ.teens + occ.children;
    if (total === 0 && occ.infants === 0 && occ.pets === 0) return '';
    const parts: string[] = [];
    if (total > 0) parts.push(`${total} occupant${total !== 1 ? 's' : ''}`);
    if (occ.infants > 0) parts.push(`${occ.infants} infant${occ.infants !== 1 ? 's' : ''}`);
    if (occ.pets > 0) parts.push(`${occ.pets} pet${occ.pets !== 1 ? 's' : ''}`);
    return parts.join(', ');
  }
  function _formatMoveInDate(d: string): string {
    if (!d) return '';
    const parts = d.split('-');
    const month = parseInt(parts[1]) - 1;
    const day = parts[2] ? parseInt(parts[2]) : null;
    const year = parseInt(parts[0]);
    const months = [
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
    const currentYear = new Date().getFullYear();
    if (day)
      return year !== currentYear ? `${months[month]} ${day}, ${year}` : `${months[month]} ${day}`;
    return `${months[month]} ${year}`;
  }

  function formatDateRangeLabel(range: {
    start: string;
    end: string;
    flexibility: string;
  }): string {
    if (!range.start) return '';
    const months = [
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
    function fmt(ds: string) {
      const [y, m, d] = ds.split('-');
      const mo = months[parseInt(m) - 1];
      const currentYear = new Date().getFullYear();
      return parseInt(y) !== currentYear ? `${mo} ${parseInt(d)}, ${y}` : `${mo} ${parseInt(d)}`;
    }
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
    if (!range.end || range.start === range.end) {
      const label = fmt(range.start);
      const suf = flexSuffix[range.flexibility];
      return suf ? `${label} ${suf}` : label;
    }
    return `${fmt(range.start)} – ${fmt(range.end)}`;
  }

  // --- mobileSheetMode: full-screen mobile search sheet reusing all panels --

  if (mobileSheetMode) {
    const whoLabel =
      occupantSummary(occupants) ||
      (occupants.infants ? `${occupants.infants} infant${occupants.infants !== 1 ? 's' : ''}` : '');
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
    const whenLabel = dateRange.start
      ? formatDateRangeLabel(dateRange)
      : dateRange.flexibility !== 'exact'
        ? (flexLabelMap[dateRange.flexibility] ?? '')
        : '';

    const handleClearAll = () => {
      if (typeof setLocation === 'function') setLocation('');
      setSelectedSuggestion(null);
      isCommittedSelectionRef.current = false;
      setIsCommittedSelection(false);
      setSuggestions([]);
      setDateRange({ start: '', end: '', flexibility: 'exact' });
      setRangePickStep('start');
      setOccupants({ adults: 0, seniors: 0, teens: 0, children: 0, infants: 0, pets: 0 });
      setDescription('');
      setActivePanel('where');
    };

    const handleSheetSearch = () => {
      const params = new URLSearchParams();
      if (selectedSuggestion) {
        params.set('q', formatLocationLabel(selectedSuggestion));
        params.set('lat', String(selectedSuggestion.lat));
        params.set('lon', String(selectedSuggestion.lon));
      } else if ((location || '').trim()) {
        params.set('q', (location || '').trim());
      }
      params.set('type', listingType);
      if (dateRange.start) params.set('moveIn', dateRange.start);
      if (dateRange.end && dateRange.end !== dateRange.start)
        params.set('moveInEnd', dateRange.end);
      const total = occupants.adults + occupants.seniors + occupants.teens + occupants.children;
      if (total > 0) params.set('guests', String(total));
      router.push(`/search?${params.toString()}`);
      onClose?.();
    };

    return (
      <div
        className="fixed inset-0 z-[60] bg-[#F7F7F7] flex flex-col"
        style={{ animation: 'mss-in 220ms ease both' }}
      >
        <style>
          {
            '@keyframes mss-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }'
          }
        </style>

        {/* ── Top bar ──────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-white border-b border-surface-border shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <p className="text-[15px] font-bold text-ink tracking-tight">Search homes</p>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-surface-alt transition-colors"
              aria-label="Close search"
            >
              <svg
                className="h-[16px] w-[16px] text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Listing type tabs */}
          <div className="flex gap-2 px-4 pb-3">
            {(['for-sale', 'for-rent'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setListingTab(tab)}
                className={`flex-1 py-2 rounded-full text-[13px] font-semibold transition-colors duration-150 ${
                  listingType === tab
                    ? 'bg-ink text-white shadow-sm'
                    : 'bg-surface-alt text-ink-muted hover:bg-[#e0e0e0]'
                }`}
              >
                {tab === 'for-sale' ? 'For Sale' : 'For Rent'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Cards ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4 space-y-2.5">
          {/* WHERE card */}
          <div
            className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
              activePanel === 'where' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'where' && setActivePanel('where')}
          >
            <div className="px-5 pt-4 pb-2">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">Where?</p>
              {activePanel === 'where' ? (
                <div className="mt-3">
                  {/* Input — same styling as desktop panel */}
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={location || ''}
                      autoComplete="off"
                      placeholder="Search city, zip, neighborhood, or address"
                      className="w-full rounded-full border border-surface-border px-5 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand/20 pr-10"
                      onChange={(e) => {
                        const val = e.target.value;
                        isCommittedSelectionRef.current = false;
                        setIsCommittedSelection(false);
                        if (typeof setLocation === 'function') setLocation(val);
                        setSelectedSuggestion(null);
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        if (!val.trim() || val.trim().length < 2) {
                          setSuggestions([]);
                          setIsDropdownOpen(true);
                          return;
                        }
                        setLoadingSuggestions(true);
                        debounceRef.current = setTimeout(async () => {
                          try {
                            const r = await fetch(`/api/geocode?q=${encodeURIComponent(val)}`);
                            setSuggestions(r.ok ? await r.json() : []);
                          } catch {
                            setSuggestions([]);
                          } finally {
                            setLoadingSuggestions(false);
                            setIsDropdownOpen(true);
                          }
                        }, 300);
                      }}
                      onFocus={async () => {
                        setIsDropdownOpen(true);
                        if (!(location || '').trim()) await handleFetchNearbyLocations();
                      }}
                    />
                    {(location || '').trim() && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (typeof setLocation === 'function') setLocation('');
                          setSelectedSuggestion(null);
                          isCommittedSelectionRef.current = false;
                          setIsCommittedSelection(false);
                          setSuggestions([]);
                          inputRef.current?.focus({ preventScroll: true });
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                        aria-label="Clear location"
                      >
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[14px] text-ink-muted mt-1 pb-2">{location || 'Anywhere'}</p>
              )}
            </div>

            {/* Dropdown list — same content as desktop panel, but inline */}
            {activePanel === 'where' && (
              <div className="relative pb-3" onMouseLeave={() => clearHighlight(whereHighlightRef)}>
                <div
                  ref={whereHighlightRef}
                  className="absolute inset-x-0 bg-[#f0f0f0] pointer-events-none"
                  style={{ top: 0, height: 0, opacity: 0 }}
                />
                <hr className="border-t border-[#f0f0f0] mb-1" />
                {/* Use current location */}
                {((location || '').trim().length < 2 || suggestions.length === 0) && (
                  <button
                    type="button"
                    onMouseEnter={(e) =>
                      applyHighlight(
                        whereHighlightRef,
                        e.currentTarget.offsetTop,
                        e.currentTarget.offsetHeight,
                      )
                    }
                    className="relative z-[1] flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
                    onClick={async () => {
                      await handleGeolocate();
                      setActivePanel('when');
                    }}
                  >
                    <span className="inline-block w-5 h-5 text-brand flex-shrink-0">
                      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="#FF385C" strokeWidth="2" />
                        <circle cx="12" cy="12" r="4" stroke="#FF385C" strokeWidth="2" />
                      </svg>
                    </span>
                    <span className="font-medium text-[15px]">Use current location</span>
                  </button>
                )}
                {(location || '').trim().length >= 2 && loadingSuggestions && (
                  <div className="px-5 py-3 text-ink-subtle text-sm">Loading…</div>
                )}
                {(location || '').trim().length >= 2 &&
                  !loadingSuggestions &&
                  suggestions.length === 0 && (
                    <div className="px-5 py-3 text-ink-subtle text-sm">No locations found</div>
                  )}
                {suggestions.map((s) => (
                  <button
                    key={s.place_id}
                    type="button"
                    onMouseEnter={(e) =>
                      applyHighlight(
                        whereHighlightRef,
                        e.currentTarget.offsetTop,
                        e.currentTarget.offsetHeight,
                      )
                    }
                    className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                    onClick={() => {
                      setSelectedSuggestion(s);
                      isCommittedSelectionRef.current = true;
                      setIsCommittedSelection(true);
                      if (typeof setLocation === 'function') setLocation(formatLocationLabel(s));
                      setSuggestions([]);
                      setIsDropdownOpen(false);
                      addRecentSearch(s);
                      setActivePanel('when');
                    }}
                  >
                    <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <path
                          d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                          fill="currentColor"
                        />
                      </svg>
                    </span>
                    <span className="text-[15px] truncate">
                      {highlightMatch(formatLocationLabel(s), location || '')}
                    </span>
                  </button>
                ))}
                {/* Nearby */}
                {((location || '').trim().length < 2 ||
                  suggestions.length === 0 ||
                  isCommittedSelection) &&
                  (loadingNearby || nearbyLocations.length > 0) && (
                    <>
                      <hr className="border-t border-[#f0f0f0] my-1" />
                      <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                        Nearby
                      </div>
                      {loadingNearby && (
                        <div className="px-5 py-2 text-ink-subtle text-sm">Loading nearby...</div>
                      )}
                      {!loadingNearby &&
                        nearbyLocations
                          .filter((loc) => {
                            if (!formatLocationLabel(loc)) return false;
                            const locLabel = formatLocationLabel(loc).toLowerCase();
                            if (
                              selectedSuggestion &&
                              loc.lat &&
                              loc.lon &&
                              selectedSuggestion.lat &&
                              selectedSuggestion.lon
                            ) {
                              if (
                                Number(loc.lat).toFixed(5) ===
                                  Number(selectedSuggestion.lat).toFixed(5) &&
                                Number(loc.lon).toFixed(5) ===
                                  Number(selectedSuggestion.lon).toFixed(5)
                              )
                                return false;
                            }
                            if (
                              selectedSuggestion &&
                              locLabel === formatLocationLabel(selectedSuggestion).toLowerCase()
                            )
                              return false;
                            return true;
                          })
                          .map((loc, idx) => (
                            <button
                              key={loc.display_name + idx}
                              type="button"
                              onMouseEnter={(e) =>
                                applyHighlight(
                                  whereHighlightRef,
                                  e.currentTarget.offsetTop,
                                  e.currentTarget.offsetHeight,
                                )
                              }
                              className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                              onClick={() => {
                                const formatted = formatLocationLabel(loc);
                                if (typeof setLocation === 'function') setLocation(formatted);
                                isCommittedSelectionRef.current = true;
                                setIsCommittedSelection(true);
                                setSelectedSuggestion({ ...loc, display_name: formatted });
                                setIsDropdownOpen(false);
                                setActivePanel('when');
                              }}
                            >
                              <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                                <svg viewBox="0 0 24 24" fill="none">
                                  <path
                                    d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
                                    fill="currentColor"
                                  />
                                </svg>
                              </span>
                              <span className="text-[15px] truncate">
                                {highlightMatch(formatLocationLabel(loc), location || '')}
                              </span>
                            </button>
                          ))}
                    </>
                  )}
                {/* Recent searches */}
                {((location || '').trim().length < 2 ||
                  suggestions.length === 0 ||
                  isCommittedSelection) &&
                  recentSearches.length > 0 && (
                    <>
                      <hr className="border-t border-[#f0f0f0] my-1" />
                      <div className="px-5 pt-2 pb-1 text-[11px] text-ink-subtle font-semibold tracking-widest uppercase">
                        Recent
                      </div>
                      {recentSearches.map((s, idx) => (
                        <div
                          key={s.display_name + idx}
                          onMouseEnter={(e) =>
                            applyHighlight(
                              whereHighlightRef,
                              e.currentTarget.offsetTop,
                              e.currentTarget.offsetHeight,
                            )
                          }
                          className="relative z-[1] flex w-full items-center px-5 py-2.5 transition-colors group"
                        >
                          <button
                            type="button"
                            className="flex items-center flex-1 min-w-0 gap-3"
                            onClick={() => {
                              setSelectedSuggestion(s);
                              isCommittedSelectionRef.current = true;
                              setIsCommittedSelection(true);
                              if (typeof setLocation === 'function')
                                setLocation(formatLocationLabel(s));
                              setIsDropdownOpen(false);
                              setActivePanel('when');
                            }}
                          >
                            <span className="inline-block w-5 h-5 text-ink-subtle flex-shrink-0">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <path
                                  d="M17.01 14h-.8l-.27-.27c.98-1.14 1.57-2.61 1.57-4.23 0-3.59-2.91-6.5-6.5-6.5s-6.5 3-6.5 6.5H2l3.84 4 4.16-4H6.51C6.51 7 8.53 5 11.01 5s4.5 2.01 4.5 4.5c0 2.48-2.02 4.5-4.5 4.5-.65 0-1.26-.14-1.82-.38L7.71 15.1c.97.57 2.09.9 3.3.9 1.61 0 3.08-.59 4.22-1.57l.27.27v.79l5.01 4.99L22 19l-4.99-5z"
                                  fill="currentColor"
                                />
                              </svg>
                            </span>
                            <span className="text-[15px] truncate">
                              {highlightMatch(formatLocationLabel(s), location || '')}
                            </span>
                          </button>
                          <button
                            type="button"
                            aria-label="Remove recent search"
                            tabIndex={-1}
                            className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-surface-alt transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRecentSearches((prev) => {
                                const updated = prev.filter((_, i) => i !== idx);
                                if (typeof window !== 'undefined')
                                  localStorage.setItem('recentSearches', JSON.stringify(updated));
                                return updated;
                              });
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                              <path
                                d="M5 5l8 8M13 5l-8 8"
                                stroke="#888"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </>
                  )}
              </div>
            )}
          </div>

          {/* WHEN card */}
          <div
            className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
              activePanel === 'when' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'when' && setActivePanel('when')}
          >
            <div className="px-5 pt-4 pb-4">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">When?</p>
              {activePanel === 'when' ? (
                <DateRangePanel
                  dateRange={dateRange}
                  setDateRange={setDateRange}
                  rangePickStep={rangePickStep}
                  setRangePickStep={setRangePickStep}
                  hoveredDate={hoveredDate}
                  setHoveredDate={setHoveredDate}
                  calendarBaseMonth={calendarBaseMonth}
                  setCalendarBaseMonth={setCalendarBaseMonth}
                  onClose={() => setActivePanel('who')}
                  listingType={listingType}
                  inline
                />
              ) : (
                <p className="text-[14px] text-ink-muted mt-1">{whenLabel || 'Anytime'}</p>
              )}
            </div>
          </div>

          {/* WHO card */}
          <div
            className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
              activePanel === 'who' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'who' && setActivePanel('who')}
          >
            <div className="px-5 pt-4 pb-4">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">Who?</p>
              {activePanel === 'who' ? (
                <div className="mt-3 space-y-4">
                  {(
                    [
                      { key: 'adults', label: 'Adults', sub: 'Ages 18–54' },
                      { key: 'seniors', label: 'Older adults', sub: '55+' },
                      { key: 'teens', label: 'Teens', sub: 'Ages 13–17' },
                      { key: 'children', label: 'Children', sub: 'Ages 2–12' },
                      { key: 'infants', label: 'Infants', sub: 'Under 2' },
                      { key: 'pets', label: 'Pets', sub: 'Bringing a service animal?' },
                    ] as const
                  ).map(({ key, label, sub }) => (
                    <div key={key} className="flex items-center justify-between">
                      <div>
                        <span className="text-[14px] font-medium text-ink">{label}</span>
                        <span className="block text-[12px] text-ink-muted">{sub}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOccupants({ ...occupants, [key]: Math.max(0, occupants[key] - 1) });
                          }}
                          disabled={occupants[key] === 0}
                          className="h-8 w-8 rounded-full border border-surface-border flex items-center justify-center text-lg text-ink-muted hover:border-ink hover:text-ink disabled:opacity-30 transition-colors"
                        >
                          –
                        </button>
                        <span className="w-5 text-center text-[14px] font-medium text-ink">
                          {occupants[key]}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOccupants({ ...occupants, [key]: occupants[key] + 1 });
                          }}
                          className="h-8 w-8 rounded-full border border-surface-border flex items-center justify-center text-lg text-ink-muted hover:border-ink hover:text-ink transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[14px] text-ink-muted mt-1">{whoLabel || 'Add occupants'}</p>
              )}
            </div>
          </div>

          {/* WHAT card */}
          <div
            className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
              activePanel === 'what' ? 'ring-2 ring-ink' : 'cursor-pointer'
            }`}
            onClick={() => activePanel !== 'what' && setActivePanel('what')}
          >
            <div className="px-5 pt-4 pb-4">
              <p className="text-[11px] font-bold text-ink uppercase tracking-wider">What?</p>
              {activePanel === 'what' ? (
                <div className="mt-3">{renderWhatPanelContent(whatHighlightRef)}</div>
              ) : (
                <p className="text-[14px] text-ink-muted mt-1">
                  {description || 'Describe your ideal home'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom bar ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 bg-white border-t border-surface-border shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <button
            onClick={handleClearAll}
            className="text-[14px] font-semibold text-ink underline underline-offset-2"
          >
            Clear all
          </button>
          <button
            onClick={handleSheetSearch}
            className="flex items-center gap-2 h-12 px-7 rounded-full bg-brand text-white font-semibold text-[14px] hover:bg-brand/90 active:scale-95 transition-transform shadow-md"
          >
            <svg
              className="h-4 w-4"
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
            Search homes
          </button>
        </div>
      </div>
    );
  }

  // --- headerMode: compact 4-slot pill (click to scroll to top) ------------

  if (headerMode) {
    return (
      <button
        type="button"
        onClick={onPillClick}
        aria-label="Expand search"
        className="flex w-full items-center rounded-full border border-[rgba(0,0,0,0.08)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.1)] transition-shadow duration-200 overflow-hidden"
      >
        {/* Where */}
        <div className="flex-1 flex flex-col justify-center px-4 py-2 text-left min-w-0">
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            Where
          </span>
          <span className="text-[13px] text-ink-muted leading-snug truncate">
            {location || 'Anywhere'}
          </span>
        </div>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* When */}
        <div className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap">
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            When
          </span>
          <span className="text-[13px] text-ink-muted leading-snug">
            {dateRange.start ? formatDateRangeLabel(dateRange) : 'Anytime'}
          </span>
        </div>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* Who */}
        <div className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap">
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            Who
          </span>
          <span className="text-[13px] text-ink-muted leading-snug">
            {occupantSummary(occupants) || 'Add occupants'}
          </span>
        </div>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* What */}
        <div className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap">
          <span className="text-[10px] font-medium text-ink-muted leading-none mb-1 select-none">
            What
          </span>
          <span className="text-[11px] sm:text-[13px] text-ink font-bold leading-snug">
            {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
          </span>
        </div>
        {/* Search icon button */}
        <div className="flex items-center pr-1.5 pl-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
            <svg
              className="h-[15px] w-[15px]"
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
          </span>
        </div>
      </button>
    );
  }

  // --- headerExpandedMode: full 4-slot bar without section wrapper --------
  // Used in the expanded header second row. Backdrop is provided by Header.tsx.

  if (headerExpandedMode) {
    return (
      <div className="relative w-full" ref={panelRef}>
        {/* 4-slot pill */}
        <div
          className={`relative flex items-center rounded-full transition-colors duration-200 ${
            activePanel ? 'bg-[#EBEBEB]' : 'bg-white shadow-card ring-1 ring-surface-border'
          }`}
        >
          {activePanel && (
            <div
              className="absolute rounded-full bg-white shadow-[0_2px_16px_rgba(0,0,0,0.15)] pointer-events-none"
              style={{
                ...(() => {
                  const s = getIndicatorStyle();
                  const left = typeof s.left === 'number' ? s.left + 1 : s.left;
                  const width = typeof s.width === 'number' ? s.width - 2 : s.width;
                  return { ...s, left, width };
                })(),
                top: '1px',
                bottom: '1px',
                transition:
                  'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          )}
          {/* WHERE */}
          <div
            className={`relative w-2/5 lg:w-1/2 shrink-0 min-w-0 ${whereShake ? 'where-shake' : ''}`}
          >
            <button
              ref={whereRef}
              type="button"
              onClick={() => {
                setActivePanel('where');
                setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
              }}
              className={`relative z-[1] w-full flex flex-col justify-center text-left px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 min-w-0 focus:outline-none ${
                activePanel && activePanel !== 'where'
                  ? 'hover:bg-[rgba(0,0,0,0.06)]'
                  : !activePanel
                    ? 'hover:bg-surface-alt/60'
                    : ''
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                Where
              </span>
              <span
                className={`text-[11px] sm:text-[13px] leading-snug truncate pr-5 ${location ? 'text-ink font-bold' : 'text-ink-subtle'}`}
              >
                {isGeolocating ? (
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <svg
                      className="h-3.5 w-3.5 animate-spin flex-shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Detecting location…
                  </span>
                ) : (
                  location || 'Anywhere'
                )}
              </span>
            </button>
            {location && activePanel === 'where' && (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (typeof setLocation === 'function') setLocation('');
                  setSelectedSuggestion(null);
                  isCommittedSelectionRef.current = false;
                  setIsCommittedSelection(false);
                  setSuggestions([]);
                }}
                className="absolute right-2 top-1/2 z-[2] -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                aria-label="Clear location"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div
            className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === 'where' || activePanel === 'when' ? 'opacity-0' : ''}`}
          />
          {/* WHEN */}
          <button
            ref={whenRef}
            type="button"
            onClick={() => setActivePanel('when')}
            className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel && activePanel !== 'when'
                ? 'hover:bg-[rgba(0,0,0,0.06)]'
                : !activePanel
                  ? 'hover:bg-surface-alt/60'
                  : ''
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
              When
            </span>
            <span
              className={`text-[11px] sm:text-[13px] leading-snug truncate ${dateRange.start ? 'text-ink' : 'text-ink-muted'}`}
            >
              {dateRange.start ? (
                formatDateRangeLabel(dateRange)
              ) : (
                <>
                  <span className="">Add dates</span>
                </>
              )}
            </span>
          </button>
          <div
            className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === 'when' || activePanel === 'who' ? 'opacity-0' : ''}`}
          />
          {/* WHO */}
          <button
            ref={whoRef}
            type="button"
            onClick={() => setActivePanel('who')}
            className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel && activePanel !== 'who'
                ? 'hover:bg-[rgba(0,0,0,0.06)]'
                : !activePanel
                  ? 'hover:bg-surface-alt/60'
                  : ''
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
              Who
            </span>
            <span
              className={`text-[11px] sm:text-[13px] leading-snug truncate ${occupantSummary(occupants) ? 'text-ink font-bold' : 'text-ink-subtle'}`}
            >
              {occupantSummary(occupants) || 'Add occupants'}
            </span>
          </button>
          <div
            className={`hidden md:block h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === 'who' || activePanel === 'what' ? 'opacity-0' : ''}`}
          />
          {/* WHAT — hidden on mobile, visible md+ */}
          <button
            ref={whatRef}
            type="button"
            onClick={() => setActivePanel('what')}
            className={`hidden md:flex relative z-[1] flex-1 min-w-0 flex-col justify-center text-left px-2 md:px-3 py-2.5 md:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel && activePanel !== 'what'
                ? 'hover:bg-[rgba(0,0,0,0.06)]'
                : !activePanel
                  ? 'hover:bg-surface-alt/60'
                  : ''
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
              What
            </span>
            <span className="text-[11px] sm:text-[13px] text-ink font-bold leading-snug truncate">
              {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
            </span>
          </button>
          {/* Search */}
          <div ref={searchBtnRef} className="flex items-center pr-1.5 pl-1 flex-shrink-0">
            <button
              type="button"
              disabled={isSearching}
              onClick={() => {
                setActivePanel(null);
                handleSearch({ preventDefault: () => {} } as any);
              }}
              className="flex items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-80 h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0"
              aria-label="Search"
            >
              {isSearching ? (
                <svg className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              ) : (
                <svg
                  className="h-4 w-4 sm:h-5 sm:w-5"
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
              )}
            </button>
          </div>
        </div>

        {/* WHERE panel */}
        {activePanel === 'where' && renderWherePanel(whereHighlightRef)}

        {/* WHEN panel */}
        {activePanel === 'when' && renderWhenPanel()}

        {/* WHO panel */}
        {activePanel === 'who' && renderWhoPanel()}

        {/* WHAT panel */}
        {activePanel === 'what' && renderWhatPanel(whatHighlightRef)}
      </div>
    );
  }

  // --- non-headerMode: full 4-slot panel bar (Airbnb 2026 style) ----------

  return (
    <section className="relative">
      {/* Click-catcher when a slot panel is open ? no visual dim */}
      <div className="relative px-3 sm:px-4 lg:px-16 py-4">
        <div ref={panelRef} className="relative w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto">
          {/* -- 4-slot pill ------------------------------------------------- */}
          <div
            className={`relative flex items-center rounded-full transition-colors duration-200 ${
              activePanel ? 'bg-[#EBEBEB]' : 'bg-white shadow-card ring-1 ring-surface-border'
            }`}
          >
            {activePanel && (
              <div
                className="absolute rounded-full bg-white shadow-[0_2px_16px_rgba(0,0,0,0.15)] pointer-events-none"
                style={{
                  ...(() => {
                    const s = getIndicatorStyle();
                    const left = typeof s.left === 'number' ? s.left + 1 : s.left;
                    const width = typeof s.width === 'number' ? s.width - 2 : s.width;
                    return { ...s, left, width };
                  })(),
                  top: '1px',
                  bottom: '1px',
                  transition:
                    'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
                }}
              />
            )}
            {/* WHERE slot */}
            <div
              className={`relative w-2/5 lg:w-1/2 shrink-0 min-w-0 ${whereShake ? 'where-shake' : ''}`}
            >
              <button
                ref={whereRef}
                type="button"
                onClick={() => {
                  setActivePanel('where');
                  setIsDropdownOpen(true);
                  setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
                }}
                className={`relative z-[1] w-full flex flex-col justify-center text-left px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 min-w-0 focus:outline-none ${
                  activePanel && activePanel !== 'where'
                    ? 'hover:bg-[rgba(0,0,0,0.06)]'
                    : !activePanel
                      ? 'hover:bg-surface-alt/60'
                      : ''
                }`}
              >
                <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                  Where
                </span>
                <span
                  className={`text-[11px] sm:text-[13px] leading-snug truncate pr-5 ${location ? 'text-ink font-bold' : 'text-ink-subtle'}`}
                >
                  {isGeolocating ? (
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <svg
                        className="h-3.5 w-3.5 animate-spin flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      Detecting location…
                    </span>
                  ) : (
                    location || 'Add locations'
                  )}
                </span>
              </button>
              {location && activePanel === 'where' && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof setLocation === 'function') setLocation('');
                    setSelectedSuggestion(null);
                    isCommittedSelectionRef.current = false;
                    setIsCommittedSelection(false);
                    setSuggestions([]);
                  }}
                  className="absolute right-2 top-1/2 z-[2] -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                  aria-label="Clear location"
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div
              className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === 'where' || activePanel === 'when' ? 'opacity-0' : ''}`}
            />

            {/* WHEN slot */}
            <button
              ref={whenRef}
              type="button"
              onClick={() => setActivePanel('when')}
              className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                activePanel && activePanel !== 'when'
                  ? 'hover:bg-[rgba(0,0,0,0.06)]'
                  : !activePanel
                    ? 'hover:bg-surface-alt/60'
                    : ''
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                When
              </span>
              <span
                className={`text-[11px] sm:text-[13px] leading-snug truncate ${dateRange.start ? 'text-ink font-bold' : 'text-ink-subtle'}`}
              >
                {dateRange.start ? (
                  formatDateRangeLabel(dateRange)
                ) : (
                  <>
                    <span className="">Add dates</span>
                  </>
                )}
              </span>
            </button>

            <div
              className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === 'when' || activePanel === 'who' ? 'opacity-0' : ''}`}
            />

            {/* WHO slot */}
            <button
              ref={whoRef}
              type="button"
              onClick={() => setActivePanel('who')}
              className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                activePanel && activePanel !== 'who'
                  ? 'hover:bg-[rgba(0,0,0,0.06)]'
                  : !activePanel
                    ? 'hover:bg-surface-alt/60'
                    : ''
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                Who
              </span>
              <span
                className={`text-[11px] sm:text-[13px] leading-snug truncate ${occupantSummary(occupants) ? 'text-ink font-bold' : 'text-ink-subtle'}`}
              >
                {occupantSummary(occupants) || 'Add occupants'}
              </span>
            </button>

            <div
              className={`hidden sm:block h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === 'who' || activePanel === 'what' ? 'opacity-0' : ''}`}
            />

            {/* WHAT slot — hidden on mobile, visible sm+ */}
            <button
              ref={whatRef}
              type="button"
              onClick={() => setActivePanel('what')}
              className={`hidden sm:flex relative z-[1] flex-1 min-w-0 flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                activePanel && activePanel !== 'what'
                  ? 'hover:bg-[rgba(0,0,0,0.06)]'
                  : !activePanel
                    ? 'hover:bg-surface-alt/60'
                    : ''
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-medium text-ink-muted leading-none mb-1">
                What
              </span>
              <span className="text-[11px] sm:text-[13px] text-ink font-bold leading-snug truncate">
                {listingType === 'for-rent' ? 'For Rent' : 'For Sale'}
              </span>
            </button>

            {/* Search button */}
            <div
              ref={searchBtnRef}
              className="relative z-[1] flex items-center pr-1.5 pl-1 flex-shrink-0"
            >
              <button
                type="button"
                disabled={isSearching}
                onClick={() => {
                  setActivePanel(null);
                  handleSearch({ preventDefault: () => {} } as any);
                }}
                className="flex items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-80 h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0"
                aria-label="Search"
              >
                {isSearching ? (
                  <svg
                    className="h-4 w-4 sm:h-5 sm:w-5 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4 sm:h-5 sm:w-5"
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
                )}
              </button>
            </div>
          </div>

          {/* WHERE panel */}
          {activePanel === 'where' && renderWherePanel(whereHighlightRef2)}

          {/* WHEN panel */}
          {activePanel === 'when' && renderWhenPanel()}

          {/* -- PANEL: WHO (occupant steppers) ------------------------------ */}
          {activePanel === 'who' && renderWhoPanel()}

          {/* -- PANEL: WHAT (description) ---------------------------------- */}
          {activePanel === 'what' && renderWhatPanel(whatHighlightRef2)}
        </div>
      </div>
    </section>
  );
}
