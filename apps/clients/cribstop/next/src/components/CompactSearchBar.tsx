"use client";

// US state name ? 2-letter abbreviation
const US_STATE_ABBR: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};
function stateAbbr(name: string): string {
  return US_STATE_ABBR[name] || name || "";
}

// Build standard US-format label ? always a single line.
// Examples: "Alexandria, VA" | "Alexandria, VA 22314" | "King St, Alexandria, VA" | "123 King St, Alexandria, VA 22314"
function formatLocationLabel(loc: any): string {
  const { primary, secondary } = getLocationParts(loc);
  if (!primary) return "";
  if (!secondary) return primary;
  // ZIP result: "Alexandria, VA 22314" (space before zip, no comma)
  if (loc.type === "postcode") return `${secondary} ${primary}`;
  // Everything else: "Primary, Secondary"
  return `${primary}, ${secondary}`;
}

// Split into primary (the identifier the user searched for) and secondary (context).
// Used for both the full label and the two-line dropdown display.
function getLocationParts(loc: any): { primary: string; secondary: string } {
  const address = loc.address || {};
  const houseNumber = address.house_number || "";
  const road = address.road || "";
  const suburb = address.suburb || address.neighbourhood || address.quarter || "";
  const city = address.city || address.town || address.village || address.hamlet || "";
  const raw = address.state || "";
  const st = address.state_code || stateAbbr(raw);
  const zip = address.postcode || "";
  const country = address.country || "";
  const isUS = !country || country === "United States";
  const cityState = [city, st].filter(Boolean).join(", ");
  const cityStateZip = zip ? `${cityState} ${zip}`.trim() : cityState;

  // Specific street address: "123 King St" ? full label includes zip
  if (houseNumber && road) {
    return { primary: `${houseNumber} ${road}`, secondary: cityStateZip };
  }

  // ZIP code search result: primary = zip, secondary = city/state for context
  if (loc.type === "postcode") {
    const z = zip || loc.display_name?.split(",")[0]?.trim() || "";
    return { primary: z, secondary: cityState };
  }

  // Street/road only
  if (road) {
    return { primary: road, secondary: cityState };
  }

  // Neighborhood / suburb
  if (suburb && city) {
    return { primary: suburb, secondary: cityState };
  }

  // City
  if (city) {
    const nonUsCountry = !isUS ? country : "";
    return { primary: city, secondary: [st, nonUsCountry].filter(Boolean).join(", ") };
  }

  // Fallback: Overpass nearby result (no address object)
  const fallbackState = loc._hint_state || "";
  const displayName = loc.display_name || "";
  return { primary: displayName, secondary: fallbackState };
}

// Extract precise search identifiers ? only set when the result type explicitly targets zip or street.
function extractSearchTerms(loc: any): { zip?: string; street?: string } {
  const address = loc.address || {};
  const result: { zip?: string; street?: string } = {};
  // Only filter by zip when the result IS a postcode (user typed "22314")
  if (loc.type === "postcode" && address.postcode) result.zip = address.postcode;
  // Filter by street when result is a road or a specific address
  if ((loc.type === "road" || loc.type === "house" || loc.type === "residential") && address.road) {
    result.street = address.house_number ? `${address.house_number} ${address.road}` : address.road;
  }
  return result;
}

// Highlight the portion of `text` that matches `query` (case-insensitive).
// Matched portion is normal weight; unmatched completion is bold ? same convention as Google/Airbnb.
function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query?.trim();
  if (!q) return <span className="font-semibold">{text}</span>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <span className="font-semibold">{text}</span>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

// Utility: Fetch nearby cities/towns/villages from Overpass API
export async function fetchNearbyLocationsByType(
  lat: number,
  lon: number,
  placeType: "city" | "town" | "village",
  radiusMeters = 20000,
  signal?: AbortSignal,
): Promise<any[]> {
  // Overpass QL: Find only the requested place type within radius
  const query = `
    [out:json][timeout:10];
    (
      node[place=${placeType}](around:${radiusMeters},${lat},${lon});
    );
    out body center 20;
  `;
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "real-estate-platform/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!response.ok) throw new Error("Overpass API error");
    const data = await response.json();
    if (!data.elements) return [];
    // Map to { display_name, lat, lon, ... }
    return data.elements.map((el: any) => ({
      display_name: el.tags?.name || "Unnamed",
      lat: el.lat,
      lon: el.lon,
      type: el.tags?.place,
      ...el.tags,
    }));
  } catch (e: any) {
    if (e?.name === "AbortError") throw e; // propagate so callers can silently ignore
    console.error("[Overpass] Nearby fetch failed", e);
    return [];
  }
}

import React, { useEffect, useRef, useState } from "react";
// import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context";

const PRICE_RANGES = [
  { label: "Any price", min: "", max: "" },
  { label: "Under $500k", min: "", max: "500000" },
  { label: "$500k ? $1M", min: "500000", max: "1000000" },
  { label: "$1M ? $2M", min: "1000000", max: "2000000" },
  { label: "$2M+", min: "2000000", max: "" },
];

const BED_OPTIONS = [
  { label: "Any beds", value: "" },
  { label: "1+ bed", value: "1" },
  { label: "2+ beds", value: "2" },
  { label: "3+ beds", value: "3" },
  { label: "4+ beds", value: "4" },
  { label: "5+ beds", value: "5" },
];

// All search data lives in AppContext so every instance (in-page, pill, expanded) shares it
export default function CompactSearchBar({
  headerMode = false,
  onPillClick,
  headerExpandedMode = false,
  onDone,
}: {
  /** When true: renders the read-only 4-slot compact pill used by Header */
  headerMode?: boolean;
  /** Called when the compact pill is clicked (headerMode only) */
  onPillClick?: () => void;
  /** When true: renders the full interactive bar without section/padding wrapper */
  headerExpandedMode?: boolean;
  /** Called after a successful search when headerExpandedMode=true */
  onDone?: () => void;
}) {
  const {
    listingTab: ctxTab,
    searchLocation,
    setSearchLocation,
    searchSuggestion,
    setSearchSuggestion,
    searchMoveInDate,
    setSearchMoveInDate,
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
  const moveInDate = searchMoveInDate;
  const setMoveInDate = setSearchMoveInDate;
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
    let placeType: "city" | "town" | "village" = "city";
    let address: any = null;
    let refSuggestion = null;
    if (!forceGeo) {
      // 1. Use selected suggestion if available
      if (selectedSuggestion && selectedSuggestion.lat && selectedSuggestion.lon) {
        refSuggestion = selectedSuggestion;
      } else if (location && suggestions.length > 0) {
        // 2. If input matches a suggestion, use that
        refSuggestion =
          suggestions.find((s) => formatLocationLabel(s).toLowerCase() === location.trim().toLowerCase()) ||
          suggestions[0];
      }
      if (refSuggestion && refSuggestion.lat && refSuggestion.lon) {
        lat = Number(refSuggestion.lat);
        lon = Number(refSuggestion.lon);
        if (refSuggestion.type === "city" || refSuggestion.type === "town" || refSuggestion.type === "village") {
          placeType = refSuggestion.type;
        }
        address = refSuggestion.address || null;
      }
      // If no valid location yet, try lastGeo (synchronous path only)
      if (lat == null || lon == null) {
        if (lastGeo && typeof lastGeo.lat === "number" && typeof lastGeo.lon === "number") {
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
      if (typeof window !== "undefined" && "geolocation" in navigator) {
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
                      Accept: "application/json",
                      "User-Agent": "real-estate-platform/1.0",
                    },
                    signal,
                  },
                );
                if (resp.ok) {
                  const data = await resp.json();
                  if (data && data.address) {
                    if (data.address.city) placeType = "city";
                    else if (data.address.town) placeType = "town";
                    else if (data.address.village) placeType = "village";
                    address = data.address;
                    setLastGeo({ lat: latitude, lon: longitude, placeType, address });
                  }
                }
              } catch (e: any) {
                if (e?.name === "AbortError") return;
                setNearbyError("Failed to determine your location type.");
                setLoadingNearby(false);
                return;
              }
              lat = latitude;
              lon = longitude;
            }
            if (typeof lat === "number" && typeof lon === "number") {
              try {
                const results = await fetchNearbyLocationsByType(lat, lon, placeType, 20000, signal);
                const hintState = address?.state || address?.state_code || "";
                const enriched = await Promise.all(
                  results.map(async (loc) => {
                    try {
                      const resp = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=10&addressdetails=1`,
                        {
                          headers: {
                            Accept: "application/json",
                            "User-Agent": "real-estate-platform/1.0",
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
                      if (e?.name !== "AbortError") console.error("[Nominatim] Enrich failed", e);
                    }
                    return { ...loc, _hint_state: hintState };
                  }),
                );
                if (signal.aborted) return;
                nearbyForKey.current = geoKey;
                setNearbyLocations(enriched);
                if (enriched.length === 0) setNearbyError("No nearby locations found.");
              } catch (e: any) {
                if (e?.name !== "AbortError") setNearbyError("Failed to fetch nearby locations.");
              }
            }
            if (!signal.aborted) setLoadingNearby(false);
          },
          () => {
            if (signal.aborted) return;
            setNearbyError("Could not get your current position. Please check browser permissions.");
            setNearbyLocations([]);
            setLoadingNearby(false);
          },
        );
        return;
      } else {
        setNearbyError("Geolocation is not supported in this browser.");
        setNearbyLocations([]);
        setLoadingNearby(false);
        return;
      }
    }
    // If we have lat/lon from suggestion or lastGeo, fetch nearby
    if (typeof lat === "number" && typeof lon === "number") {
      const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
      try {
        const results = await fetchNearbyLocationsByType(lat, lon, placeType, 20000, signal);
        // Enrich each result with Nominatim reverse geocode for address
        const hintState = address?.state || address?.state_code || "";
        const enriched = await Promise.all(
          results.map(async (loc) => {
            try {
              const resp = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lon}&zoom=10&addressdetails=1`,
                {
                  headers: { Accept: "application/json", "User-Agent": "real-estate-platform/1.0" },
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
              if (e?.name !== "AbortError") console.error("[Nominatim] Enrich failed", e);
            }
            return { ...loc, _hint_state: hintState };
          }),
        );
        if (signal.aborted) return;
        nearbyForKey.current = key;
        setNearbyLocations(enriched);
        if (enriched.length === 0) setNearbyError("No nearby locations found.");
      } catch (e: any) {
        if (e?.name !== "AbortError") setNearbyError("Failed to fetch nearby locations.");
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
  const [activePanel, setActivePanel] = useState<"where" | "when" | "who" | "what" | null>(null);
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
    if (activePanel === "what" && searchBtnRef.current) {
      return { left: btn.offsetLeft, width: btn.offsetWidth + searchBtnRef.current.offsetWidth };
    }
    return { left: btn.offsetLeft, width: btn.offsetWidth };
  };
  const [calendarBaseMonth, setCalendarBaseMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Load recent searches from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("recentSearches");
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
      if (typeof window !== "undefined") {
        localStorage.setItem("recentSearches", JSON.stringify(updated));
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
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [activePanel]);

  // Close activePanel on searchbar:close event (fired during header transitions)
  useEffect(() => {
    function handleClose() {
      setActivePanel(null);
      setIsDropdownOpen(false);
    }
    window.addEventListener("searchbar:close", handleClose);
    return () => window.removeEventListener("searchbar:close", handleClose);
  }, []);

  // "What" description free-text
  const [description, setDescription] = useState("");
  const whatSuggestionsRef = useRef<HTMLDivElement>(null);
  const whatHighlightRef = useRef<HTMLDivElement>(null);
  const whereHighlightRef = useRef<HTMLDivElement>(null);
  const whereHighlightRef2 = useRef<HTMLDivElement>(null);
  const whatHighlightRef2 = useRef<HTMLDivElement>(null);

  const SLIDE_TRANSITION = "top 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.12s";
  const FADE_ONLY_TRANSITION = "opacity 0.12s";

  function applyHighlight(ref: React.RefObject<HTMLDivElement | null>, top: number, height: number) {
    const el = ref.current;
    if (!el) return;
    const isHidden = parseFloat(el.style.opacity || "0") < 0.5;
    if (isHidden) {
      // Snap to position instantly, then fade in — no sliding from nowhere
      el.style.transition = "none";
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
      el.getBoundingClientRect(); // force reflow so browser paints position before transition re-enables
      el.style.transition = SLIDE_TRANSITION;
      el.style.opacity = "1";
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
    el.style.opacity = "0";
  }

  const SUGGESTED_DESCRIPTIONS = [
    "Spacious place with bunk beds and board games",
    "A pool, outdoor dining area, hammocks, and a fire pit",
    "Bright open plan with a modern kitchen and yard",
    "Quiet home office setup with fast WiFi",
  ];

  // listingType mirrors context listingTab with a local copy for optimistic tab switch animation
  const [listingType, setListingType] = useState<"for-sale" | "for-rent">(listingTab || "for-sale");

  React.useEffect(() => {
    if (listingTab && listingTab !== listingType) setListingType(listingTab);
  }, [listingTab]);

  // Enhanced search: if location is empty, use geolocation; else require valid suggestion
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(location || "").trim()) {
      await handleGeolocate();
      return;
    }
    // If user hasn't selected a suggestion, but suggestions exist, auto-select the first
    let finalSuggestion = selectedSuggestion;
    if (!selectedSuggestion && suggestions.length > 0) {
      finalSuggestion = suggestions[0];
      setSelectedSuggestion(finalSuggestion);
      isCommittedSelectionRef.current = true;
      setIsCommittedSelection(true);
      if (typeof setLocation === "function") setLocation(formatLocationLabel(finalSuggestion));
    }
    if (!finalSuggestion) {
      // No valid location, do nothing
      return;
    }
    // Use the selected/closest suggestion
    addRecentSearch(finalSuggestion);
    const label = formatLocationLabel(finalSuggestion);
    if (typeof setLocation === "function") setLocation(label);
    const { zip, street } = extractSearchTerms(finalSuggestion);
    const params = new URLSearchParams();
    params.set("q", label);
    params.set("lat", finalSuggestion.lat);
    params.set("lon", finalSuggestion.lon);
    if (zip) params.set("zip", zip);
    if (street) params.set("street", street);
    const price = PRICE_RANGES[priceIdx];
    // (already reset at start of handler)
    if (price.min) params.set("minPrice", price.min);
    if (price.max) params.set("maxPrice", price.max);
    const beds = BED_OPTIONS[bedsIdx].value;
    if (beds) params.set("beds", beds);
    params.set("type", listingType);
    router.push(`/search?${params.toString()}`);
    setIsDropdownOpen(false);
    setActivePanel(null);
    onDone?.();
  };

  // Always trigger geolocation and update location input
  const handleGeolocate = async () => {
    // Cancel any previous in-flight geolocate fetch
    geoAbortRef.current?.abort();
    const ac = new AbortController();
    geoAbortRef.current = ac;
    const signal = ac.signal;

    if (typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (signal.aborted) return;
          const { latitude, longitude } = pos.coords;
          (async () => {
            let displayName = `Current Location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
            try {
              const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
                {
                  headers: { Accept: "application/json", "User-Agent": "real-estate-platform/1.0" },
                  signal,
                },
              );
              // error handling is in the correct handler, not here
              if (response.ok) {
                const data = await response.json();
                if (data && data.address) {
                  // Compose 'City, State' if possible
                  // error handling is in the correct handler, not here
                  const city = data.address.city || data.address.town || data.address.village || "";
                  // error handling is in the correct handler, not here
                  const state = data.address.state || data.address.state_code || "";
                  const parts = [];
                  if (city) parts.push(city);
                  if (state) parts.push(state);
                  const formatted = parts.join(", ");
                  // error handling is in the correct handler, not here
                  displayName = formatted || displayName;
                }
              }
            } catch (e: any) {
              if (e?.name === "AbortError") return;
            }
            if (signal.aborted) return;
            if (typeof setLocation === "function") setLocation(displayName);
            const params = new URLSearchParams();
            params.set("q", displayName);
            const price = PRICE_RANGES[priceIdx];
            if (price.min) params.set("minPrice", price.min);
            if (price.max) params.set("maxPrice", price.max);
            const beds = BED_OPTIONS[bedsIdx].value;
            if (beds) params.set("beds", beds);
            params.set("type", listingType);
            router.push(`/search?${params.toString()}`);
          })();
        },
        (err) => {
          if (signal.aborted) return;
          console.error("[Geolocation] Error getting current position:", err);
          alert("Unable to get your current location. Please check your browser permissions and try again.");
          if (typeof setLocation === "function") setLocation("");
          const params = new URLSearchParams();
          params.set("q", "");
          const price = PRICE_RANGES[priceIdx];
          if (price.min) params.set("minPrice", price.min);
          if (price.max) params.set("maxPrice", price.max);
          const beds = BED_OPTIONS[bedsIdx].value;
          if (beds) params.set("beds", beds);
          params.set("type", listingType);
          router.push(`/search?${params.toString()}`);
        },
      );
    } else {
      alert("Geolocation is not supported in this browser.");
      if (typeof setLocation === "function") setLocation("");
      const params = new URLSearchParams();
      params.set("q", "");
      const price = PRICE_RANGES[priceIdx];
      if (price.min) params.set("minPrice", price.min);
      if (price.max) params.set("maxPrice", price.max);
      const beds = BED_OPTIONS[bedsIdx].value;
      if (beds) params.set("beds", beds);
      params.set("type", listingType);
      router.push(`/search?${params.toString()}`);
    }
  };

  // --- helpers (used in both render paths) ---------------------------------

  function getDaysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
  }
  function getFirstDayOffset(year: number, month: number): number {
    return new Date(year, month, 1).getDay();
  }
  const MONTH_NAMES_LONG = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  function occupantSummary(occ: { adults: number; children: number; infants: number; pets: number }): string {
    const total = occ.adults + occ.children;
    if (total === 0 && occ.infants === 0 && occ.pets === 0) return "";
    const parts: string[] = [];
    if (total > 0) parts.push(`${total} guest${total !== 1 ? "s" : ""}`);
    if (occ.infants > 0) parts.push(`${occ.infants} infant${occ.infants !== 1 ? "s" : ""}`);
    if (occ.pets > 0) parts.push(`${occ.pets} pet${occ.pets !== 1 ? "s" : ""}`);
    return parts.join(", ");
  }
  function formatMoveInDate(d: string): string {
    if (!d) return "";
    const parts = d.split("-");
    const month = parseInt(parts[1]) - 1;
    const day = parts[2] ? parseInt(parts[2]) : null;
    const year = parseInt(parts[0]);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentYear = new Date().getFullYear();
    if (day) return year !== currentYear ? `${months[month]} ${day}, ${year}` : `${months[month]} ${day}`;
    return `${months[month]} ${year}`;
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
          <span className="text-[10px] font-bold text-ink leading-none mb-0.5 select-none">Where</span>
          <span className="text-[13px] text-ink-muted leading-snug truncate">{location || "Anywhere"}</span>
        </div>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* When */}
        <div className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap">
          <span className="text-[10px] font-bold text-ink leading-none mb-0.5 select-none">When</span>
          <span className="text-[13px] text-ink-muted leading-snug">
            {moveInDate ? formatMoveInDate(moveInDate) : "Anytime"}
          </span>
        </div>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* Who */}
        <div className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap">
          <span className="text-[10px] font-bold text-ink leading-none mb-0.5 select-none">Who</span>
          <span className="text-[13px] text-ink-muted leading-snug">
            {occupantSummary(occupants) || "Add occupants"}
          </span>
        </div>
        <div className="my-auto h-5 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)]" />
        {/* What */}
        <div className="flex flex-col justify-center px-4 py-2 text-left whitespace-nowrap">
          <span className="text-[10px] font-bold text-ink leading-none mb-0.5 select-none">What</span>
          <span className="text-[13px] text-ink-muted leading-snug">Filters</span>
        </div>
        {/* Search icon button */}
        <div className="flex items-center pr-1.5 pl-1">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
            <svg className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
            activePanel ? "bg-[#EBEBEB]" : "bg-white shadow-card ring-1 ring-surface-border"
          }`}
        >
          {activePanel && (
            <div
              className="absolute top-0 bottom-0 rounded-full bg-white shadow-[0_2px_16px_rgba(0,0,0,0.15)] pointer-events-none"
              style={{
                ...getIndicatorStyle(),
                transition: "left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)",
              }}
            />
          )}
          {/* WHERE */}
          <div className="relative w-2/5 lg:w-1/2 shrink-0 min-w-0">
            <button
              ref={whereRef}
              type="button"
              onClick={() => {
                setActivePanel("where");
                setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
              }}
              className={`relative z-[1] w-full flex flex-col justify-center text-left px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 min-w-0 focus:outline-none ${
                activePanel && activePanel !== "where"
                  ? "hover:bg-[rgba(0,0,0,0.06)]"
                  : !activePanel
                    ? "hover:bg-surface-alt/60"
                    : ""
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">Where</span>
              <span
                className={`text-[13px] sm:text-[15px] leading-snug truncate pr-5 ${location ? "text-ink font-medium" : "text-ink-muted"}`}
              >
                {location || "Anywhere"}
              </span>
            </button>
            {location && activePanel === "where" && (
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (typeof setLocation === "function") setLocation("");
                  setSelectedSuggestion(null);
                  isCommittedSelectionRef.current = false;
                  setIsCommittedSelection(false);
                  setSuggestions([]);
                }}
                className="absolute right-2 top-1/2 z-[2] -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                aria-label="Clear location"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div
            className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === "where" || activePanel === "when" ? "opacity-0" : ""}`}
          />
          {/* WHEN */}
          <button
            ref={whenRef}
            type="button"
            onClick={() => setActivePanel("when")}
            className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel && activePanel !== "when"
                ? "hover:bg-[rgba(0,0,0,0.06)]"
                : !activePanel
                  ? "hover:bg-surface-alt/60"
                  : ""
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">When</span>
            <span
              className={`text-[13px] sm:text-[15px] leading-snug truncate ${moveInDate ? "text-ink font-medium" : "text-ink-muted"}`}
            >
              {moveInDate ? formatMoveInDate(moveInDate) : "Add timeline"}
            </span>
          </button>
          <div
            className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === "when" || activePanel === "who" ? "opacity-0" : ""}`}
          />
          {/* WHO */}
          <button
            ref={whoRef}
            type="button"
            onClick={() => setActivePanel("who")}
            className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel && activePanel !== "who"
                ? "hover:bg-[rgba(0,0,0,0.06)]"
                : !activePanel
                  ? "hover:bg-surface-alt/60"
                  : ""
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">Who</span>
            <span
              className={`text-[13px] sm:text-[15px] leading-snug truncate ${occupantSummary(occupants) ? "text-ink font-medium" : "text-ink-muted"}`}
            >
              {occupantSummary(occupants) || "Add occupants"}
            </span>
          </button>
          <div
            className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity ${activePanel === "who" || activePanel === "what" ? "opacity-0" : ""}`}
          />
          {/* WHAT */}
          <button
            ref={whatRef}
            type="button"
            onClick={() => setActivePanel("what")}
            className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
              activePanel && activePanel !== "what"
                ? "hover:bg-[rgba(0,0,0,0.06)]"
                : !activePanel
                  ? "hover:bg-surface-alt/60"
                  : ""
            }`}
          >
            <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">What</span>
            <span className="text-[13px] sm:text-[15px] text-ink-muted leading-snug truncate">Add description</span>
          </button>
          {/* Search */}
          <div ref={searchBtnRef} className="flex items-center pr-1.5 pl-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
                handleSearch({ preventDefault: () => {} } as any);
              }}
              className="flex items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-700 h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0"
              aria-label="Search"
            >
              <svg
                className="h-4 w-4 sm:h-5 sm:w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* WHERE panel */}
        {activePanel === "where" && (
          <div
            className="search-panel-enter absolute left-0 z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border w-full max-w-sm sm:max-w-lg overflow-hidden"
            style={{ top: "calc(100% + 6px)" }}
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
                    if (typeof setLocation === "function") setLocation(val);
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
                    if (!location.trim()) await handleFetchNearbyLocations();
                  }}
                />
                {location && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (typeof setLocation === "function") setLocation("");
                      setSelectedSuggestion(null);
                      isCommittedSelectionRef.current = false;
                      setIsCommittedSelection(false);
                      setSuggestions([]);
                      inputRef.current?.focus({ preventScroll: true });
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                    aria-label="Clear location"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div
              ref={dropdownRef}
              className="relative pb-3 max-h-64 overflow-y-auto"
              onMouseLeave={() => clearHighlight(whereHighlightRef)}
            >
              <div
                ref={whereHighlightRef}
                className="absolute inset-x-0 bg-[#f0f0f0] pointer-events-none"
                style={{ top: 0, height: 0, opacity: 0 }}
              />
              <hr className="border-t border-[#f0f0f0] mb-1" />
              {(location.trim().length < 2 || suggestions.length === 0) && (
                <button
                  type="button"
                  onMouseEnter={(e) =>
                    applyHighlight(whereHighlightRef, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
                  }
                  className="relative z-[1] flex w-full items-center gap-3 px-5 py-3 text-left transition-colors"
                  onClick={async () => {
                    await handleGeolocate();
                    setActivePanel(null);
                  }}
                >
                  <span className="text-brand flex-shrink-0">
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
                    applyHighlight(whereHighlightRef, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
                  }
                  className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                  onClick={() => {
                    setSelectedSuggestion(s);
                    isCommittedSelectionRef.current = true;
                    setIsCommittedSelection(true);
                    if (typeof setLocation === "function") setLocation(formatLocationLabel(s));
                    setActivePanel(null);
                    addRecentSearch(s);
                  }}
                >
                  <span className="w-5 h-5 text-ink-subtle flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <path
                        d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span className="text-[15px] truncate">{highlightMatch(formatLocationLabel(s), location)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* WHEN panel */}
        {activePanel === "when" && (
          <div
            className="search-panel-enter absolute z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border p-4 sm:p-6 w-full sm:w-auto sm:left-[20%]"
            style={{ top: "calc(100% + 6px)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-ink text-[15px]">When do you want to move in?</span>
              {moveInDate && (
                <button
                  type="button"
                  onClick={() => setMoveInDate("")}
                  className="ml-4 text-sm font-semibold text-brand hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-6">
              {[0, 1].map((offset) => {
                const totalMonth = calendarBaseMonth.month + offset;
                const year = calendarBaseMonth.year + Math.floor(totalMonth / 12);
                const month = ((totalMonth % 12) + 12) % 12;
                const daysInMonth = getDaysInMonth(year, month);
                const firstDayOff = getFirstDayOffset(year, month);
                const today = new Date();
                return (
                  <div key={offset} className="min-w-[200px]">
                    <div className="flex items-center justify-between mb-3">
                      {offset === 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setCalendarBaseMonth(({ year: y, month: m }) => {
                              const pm = m === 0 ? 11 : m - 1;
                              const py = m === 0 ? y - 1 : y;
                              const now = new Date();
                              if (py < now.getFullYear() || (py === now.getFullYear() && pm < now.getMonth()))
                                return { year: y, month: m };
                              return { year: py, month: pm };
                            })
                          }
                          className="p-1 rounded-full hover:bg-surface-alt"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      ) : (
                        <div className="w-6" />
                      )}
                      <span className="text-sm font-semibold">
                        {MONTH_NAMES_LONG[month]} {year}
                      </span>
                      {offset === 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setCalendarBaseMonth(({ year: y, month: m }) => {
                              const nm = m === 11 ? 0 : m + 1;
                              const ny = m === 11 ? y + 1 : y;
                              return { year: ny, month: nm };
                            })
                          }
                          className="p-1 rounded-full hover:bg-surface-alt"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      ) : (
                        <div className="w-6" />
                      )}
                    </div>
                    <div className="grid grid-cols-7 mb-1">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                        <div key={d} className="text-center text-[11px] text-ink-subtle font-medium py-1">
                          {d}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-y-1">
                      {Array.from({ length: firstDayOff }, (_, i) => (
                        <div key={`e${i}`} />
                      ))}
                      {Array.from({ length: daysInMonth }, (_, i) => {
                        const day = i + 1;
                        const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const isSel = moveInDate === ds;
                        const isPast =
                          new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
                        return (
                          <button
                            key={day}
                            type="button"
                            disabled={isPast}
                            onClick={() => {
                              setMoveInDate(isSel ? "" : ds);
                              setActivePanel(null);
                            }}
                            className={`aspect-square flex items-center justify-center rounded-full text-[13px] transition-colors focus:outline-none ${isSel ? "bg-ink text-white font-semibold" : ""} ${!isSel && !isPast ? "hover:bg-surface-alt" : ""} ${isPast ? "text-ink-subtle/40 cursor-default" : "text-ink"}`}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-surface-border">
              <button
                type="button"
                onClick={() => {
                  setMoveInDate("");
                  setActivePanel(null);
                }}
                className={`w-full rounded-full py-2.5 text-sm font-semibold transition-colors border ${!moveInDate ? "border-ink bg-ink text-white" : "border-surface-border text-ink hover:border-ink"}`}
              >
                I&apos;m flexible
              </button>
            </div>
          </div>
        )}

        {/* WHO panel */}
        {activePanel === "who" && (
          <div
            className="search-panel-enter absolute z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border p-5 w-full sm:w-[340px] sm:right-16"
            style={{ top: "calc(100% + 6px)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-[13px] text-ink-muted mb-2">How many people will live here?</p>
            {(
              [
                { key: "adults", label: "Adults", desc: "18 or above" },
                { key: "children", label: "Children", desc: "Ages 2?17" },
                { key: "infants", label: "Infants", desc: "Under 2" },
                { key: "pets", label: "Pets", desc: "Bringing pets?" },
              ] as const
            ).map(({ key, label, desc }, i, arr) => (
              <div
                key={key}
                className={`flex items-center justify-between py-4 ${i < arr.length - 1 ? "border-b border-surface-border" : ""}`}
              >
                <div>
                  <div className="font-semibold text-[15px]">{label}</div>
                  <div className="text-[13px] text-ink-muted">{desc}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={occupants[key] === 0}
                    onClick={() => setOccupants({ ...occupants, [key]: Math.max(0, occupants[key] - 1) })}
                    className={`h-8 w-8 rounded-full border flex items-center justify-center text-lg transition-colors ${occupants[key] === 0 ? "border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default" : "border-[rgba(0,0,0,0.4)] text-ink hover:border-ink"}`}
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
        )}

        {/* WHAT panel */}
        {activePanel === "what" && (
          <div
            className="search-panel-enter absolute z-[200] bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border w-full sm:w-[420px] sm:right-0"
            style={{ top: "calc(100% + 6px)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-5">
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
                  onClick={() => setDescription("")}
                  className="mt-1 text-xs font-semibold text-ink-muted hover:text-ink underline"
                >
                  Clear
                </button>
              )}
              <p className="mt-4 mb-2 text-sm font-semibold text-brand">Suggested descriptions</p>
              <div
                ref={whatSuggestionsRef}
                className="relative flex flex-col gap-1"
                onMouseLeave={() => clearHighlight(whatHighlightRef)}
              >
                <div
                  ref={whatHighlightRef}
                  className="absolute inset-x-0 rounded-xl bg-surface-alt pointer-events-none"
                  style={{ top: 0, height: 0, opacity: 0 }}
                />
                {SUGGESTED_DESCRIPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setDescription(s);
                      setActivePanel(null);
                    }}
                    onMouseEnter={(e) =>
                      applyHighlight(whatHighlightRef, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
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
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- non-headerMode: full 4-slot panel bar (Airbnb 2026 style) ----------

  return (
    <section className="relative">
      {/* Click-catcher when a slot panel is open ? no visual dim */}
      <div className="relative z-50 px-3 sm:px-4 lg:px-16 py-4">
        <div ref={panelRef} className="relative w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto">
          {/* -- 4-slot pill ------------------------------------------------- */}
          <div
            className={`relative flex items-center rounded-full transition-colors duration-200 ${
              activePanel ? "bg-[#EBEBEB]" : "bg-white shadow-card ring-1 ring-surface-border"
            }`}
          >
            {activePanel && (
              <div
                className="absolute top-0 bottom-0 rounded-full bg-white shadow-[0_2px_16px_rgba(0,0,0,0.15)] pointer-events-none"
                style={{
                  ...getIndicatorStyle(),
                  transition: "left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)",
                }}
              />
            )}
            {/* WHERE slot */}
            <div className="relative w-2/5 lg:w-1/2 shrink-0 min-w-0">
              <button
                ref={whereRef}
                type="button"
                onClick={() => {
                  setActivePanel("where");
                  setIsDropdownOpen(true);
                  setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
                }}
                className={`relative z-[1] w-full flex flex-col justify-center text-left px-3 sm:px-4 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 min-w-0 focus:outline-none ${
                  activePanel && activePanel !== "where"
                    ? "hover:bg-[rgba(0,0,0,0.06)]"
                    : !activePanel
                      ? "hover:bg-surface-alt/60"
                      : ""
                }`}
              >
                <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">Where</span>
                <span
                  className={`text-[13px] sm:text-[15px] leading-snug truncate pr-5 ${location ? "text-ink font-medium" : "text-ink-muted"}`}
                >
                  {location || "Anywhere"}
                </span>
              </button>
              {location && activePanel === "where" && (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof setLocation === "function") setLocation("");
                    setSelectedSuggestion(null);
                    isCommittedSelectionRef.current = false;
                    setIsCommittedSelection(false);
                    setSuggestions([]);
                  }}
                  className="absolute right-2 top-1/2 z-[2] -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                  aria-label="Clear location"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div
              className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === "where" || activePanel === "when" ? "opacity-0" : ""}`}
            />

            {/* WHEN slot */}
            <button
              ref={whenRef}
              type="button"
              onClick={() => setActivePanel("when")}
              className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                activePanel && activePanel !== "when"
                  ? "hover:bg-[rgba(0,0,0,0.06)]"
                  : !activePanel
                    ? "hover:bg-surface-alt/60"
                    : ""
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">When</span>
              <span
                className={`text-[13px] sm:text-[15px] leading-snug truncate ${moveInDate ? "text-ink font-medium" : "text-ink-muted"}`}
              >
                {moveInDate ? formatMoveInDate(moveInDate) : "Add timeline"}
              </span>
            </button>

            <div
              className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === "when" || activePanel === "who" ? "opacity-0" : ""}`}
            />

            {/* WHO slot */}
            <button
              ref={whoRef}
              type="button"
              onClick={() => setActivePanel("who")}
              className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                activePanel && activePanel !== "who"
                  ? "hover:bg-[rgba(0,0,0,0.06)]"
                  : !activePanel
                    ? "hover:bg-surface-alt/60"
                    : ""
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">Who</span>
              <span
                className={`text-[13px] sm:text-[15px] leading-snug truncate ${occupantSummary(occupants) ? "text-ink font-medium" : "text-ink-muted"}`}
              >
                {occupantSummary(occupants) || "Add occupants"}
              </span>
            </button>

            <div
              className={`h-6 w-px flex-shrink-0 bg-[rgba(0,0,0,0.12)] transition-opacity duration-150 ${activePanel === "who" || activePanel === "what" ? "opacity-0" : ""}`}
            />

            {/* WHAT slot */}
            <button
              ref={whatRef}
              type="button"
              onClick={() => setActivePanel("what")}
              className={`relative z-[1] flex-1 min-w-0 flex flex-col justify-center text-left px-2 sm:px-3 py-2.5 sm:py-3.5 rounded-full transition-colors duration-150 focus:outline-none ${
                activePanel && activePanel !== "what"
                  ? "hover:bg-[rgba(0,0,0,0.06)]"
                  : !activePanel
                    ? "hover:bg-surface-alt/60"
                    : ""
              }`}
            >
              <span className="text-[11px] sm:text-[12px] font-bold text-ink leading-none mb-0.5">What</span>
              <span className="text-[13px] sm:text-[15px] text-ink-muted leading-snug truncate">Add description</span>
            </button>

            {/* Search button */}
            <div ref={searchBtnRef} className="relative z-[1] flex items-center pr-1.5 pl-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActivePanel(null);
                  handleSearch({ preventDefault: () => {} } as any);
                }}
                className="flex items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-700 h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0"
                aria-label="Search"
              >
                <svg
                  className="h-4 w-4 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* -- PANEL: WHERE ------------------------------------------------ */}
          {activePanel === "where" && (
            <div
              className="search-panel-enter absolute left-0 z-50 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border w-full max-w-lg overflow-hidden"
              style={{ top: "calc(100% + 6px)" }}
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
                      if (typeof setLocation === "function") setLocation(val);
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
                        if (typeof setLocation === "function") setLocation("");
                        setSelectedSuggestion(null);
                        isCommittedSelectionRef.current = false;
                        setIsCommittedSelection(false);
                        setSuggestions([]);
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/[0.08] text-ink/50 hover:text-ink transition-colors"
                      aria-label="Clear location"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <div
                ref={dropdownRef}
                className="relative pb-3 max-h-72 overflow-y-auto"
                onMouseLeave={() => clearHighlight(whereHighlightRef2)}
              >
                <div
                  ref={whereHighlightRef2}
                  className="absolute inset-x-0 bg-[#f0f0f0] pointer-events-none"
                  style={{ top: 0, height: 0, opacity: 0 }}
                />
                <hr className="border-t border-[#f0f0f0] mb-1" />
                {/* Use current location */}
                {(location.trim().length < 2 || suggestions.length === 0) && (
                  <button
                    type="button"
                    onMouseEnter={(e) =>
                      applyHighlight(whereHighlightRef2, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
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
                      applyHighlight(whereHighlightRef2, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
                    }
                    className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                    onClick={() => {
                      setSelectedSuggestion(s);
                      isCommittedSelectionRef.current = true;
                      setIsCommittedSelection(true);
                      if (typeof setLocation === "function") setLocation(formatLocationLabel(s));
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
                    <span className="text-[15px] truncate">{highlightMatch(formatLocationLabel(s), location)}</span>
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
                      {loadingNearby && <div className="px-5 py-2 text-ink-subtle text-sm">Loading nearby...</div>}
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
                                Number(loc.lat).toFixed(5) === Number(selectedSuggestion.lat).toFixed(5) &&
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
                                  whereHighlightRef2,
                                  e.currentTarget.offsetTop,
                                  e.currentTarget.offsetHeight,
                                )
                              }
                              className="relative z-[1] flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors"
                              onClick={() => {
                                const formatted = formatLocationLabel(loc);
                                if (typeof setLocation === "function") setLocation(formatted);
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
                            applyHighlight(whereHighlightRef2, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
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
                              if (typeof setLocation === "function") setLocation(formatLocationLabel(s));
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
                                if (typeof window !== "undefined")
                                  localStorage.setItem("recentSearches", JSON.stringify(updated));
                                return updated;
                              });
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                              <path d="M5 5l8 8M13 5l-8 8" stroke="#888" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </>
                  )}
              </div>
            </div>
          )}

          {/* -- PANEL: WHEN (2-month calendar) ------------------------------ */}
          {activePanel === "when" && (
            <div
              className="search-panel-enter absolute z-50 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border p-6"
              style={{ top: "calc(100% + 6px)", left: "28%" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-ink">When do you want to move in?</span>
                {moveInDate && (
                  <button
                    type="button"
                    onClick={() => setMoveInDate("")}
                    className="ml-4 text-sm font-semibold text-brand hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[13px] text-ink-muted mb-4">Select your target move-in date</p>
              <div className="flex gap-8">
                {[0, 1].map((offset) => {
                  const totalMonth = calendarBaseMonth.month + offset;
                  const year = calendarBaseMonth.year + Math.floor(totalMonth / 12);
                  const month = ((totalMonth % 12) + 12) % 12;
                  const daysInMonth = getDaysInMonth(year, month);
                  const firstDayOff = getFirstDayOffset(year, month);
                  const today = new Date();
                  return (
                    <div key={offset} className="min-w-[220px]">
                      <div className="flex items-center justify-between mb-3">
                        {offset === 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setCalendarBaseMonth(({ year: y, month: m }) => {
                                const prevM = m === 0 ? 11 : m - 1;
                                const prevY = m === 0 ? y - 1 : y;
                                const now = new Date();
                                if (
                                  prevY < now.getFullYear() ||
                                  (prevY === now.getFullYear() && prevM < now.getMonth())
                                )
                                  return { year: y, month: m };
                                return { year: prevY, month: prevM };
                              })
                            }
                            className="p-1 rounded-full hover:bg-surface-alt transition-colors"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        ) : (
                          <div className="w-6" />
                        )}
                        <span className="text-sm font-semibold text-ink">
                          {MONTH_NAMES_LONG[month]} {year}
                        </span>
                        {offset === 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setCalendarBaseMonth(({ year: y, month: m }) => {
                                const nextM = m === 11 ? 0 : m + 1;
                                const nextY = m === 11 ? y + 1 : y;
                                return { year: nextY, month: nextM };
                              })
                            }
                            className="p-1 rounded-full hover:bg-surface-alt transition-colors"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        ) : (
                          <div className="w-6" />
                        )}
                      </div>
                      <div className="grid grid-cols-7 mb-1">
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                          <div key={d} className="text-center text-[11px] text-ink-subtle font-medium py-1">
                            {d}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-y-1">
                        {Array.from({ length: firstDayOff }, (_, i) => (
                          <div key={`e${i}`} />
                        ))}
                        {Array.from({ length: daysInMonth }, (_, i) => {
                          const day = i + 1;
                          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                          const isSelected = moveInDate === dateStr;
                          const isPast =
                            new Date(year, month, day) <
                            new Date(today.getFullYear(), today.getMonth(), today.getDate());
                          return (
                            <button
                              key={day}
                              type="button"
                              disabled={isPast}
                              onClick={() => {
                                setMoveInDate(isSelected ? "" : dateStr);
                                setActivePanel(null);
                              }}
                              className={`aspect-square flex items-center justify-center rounded-full text-[13px] transition-colors focus:outline-none
                                ${isSelected ? "bg-ink text-white font-semibold" : ""}
                                ${!isSelected && !isPast ? "hover:bg-surface-alt" : ""}
                                ${isPast ? "text-ink-subtle/40 cursor-default" : "text-ink"}`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-surface-border">
                <button
                  type="button"
                  onClick={() => {
                    setMoveInDate("");
                    setActivePanel(null);
                  }}
                  className={`w-full rounded-full py-2.5 text-sm font-semibold transition-colors border ${
                    !moveInDate ? "border-ink bg-ink text-white" : "border-surface-border text-ink hover:border-ink"
                  }`}
                >
                  I&apos;m flexible
                </button>
              </div>
            </div>
          )}

          {/* -- PANEL: WHO (occupant steppers) ------------------------------ */}
          {activePanel === "who" && (
            <div
              className="search-panel-enter absolute z-50 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border p-6 w-[360px]"
              style={{ top: "calc(100% + 6px)", right: "64px" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p className="text-[13px] text-ink-muted mb-2">How many people will live here?</p>
              {(
                [
                  { key: "adults" as const, label: "Adults", desc: "18 or above" },
                  { key: "children" as const, label: "Children", desc: "Ages 2?17" },
                  { key: "infants" as const, label: "Infants", desc: "Under 2" },
                  { key: "pets" as const, label: "Pets", desc: "Bringing pets?" },
                ] as const
              ).map(({ key, label, desc }, i, arr) => (
                <div
                  key={key}
                  className={`flex items-center justify-between py-4 ${i < arr.length - 1 ? "border-b border-surface-border" : ""}`}
                >
                  <div>
                    <div className="font-semibold text-[15px] text-ink">{label}</div>
                    <div className="text-[13px] text-ink-muted">{desc}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={occupants[key] === 0}
                      onClick={() => setOccupants({ ...occupants, [key]: Math.max(0, occupants[key] - 1) })}
                      className={`h-8 w-8 rounded-full border flex items-center justify-center text-lg transition-colors
                        ${
                          occupants[key] === 0
                            ? "border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default"
                            : "border-[rgba(0,0,0,0.4)] text-ink hover:border-ink cursor-pointer"
                        }`}
                    >
                      -
                    </button>
                    <span className="w-4 text-center text-[15px] font-medium text-ink">{occupants[key]}</span>
                    <button
                      type="button"
                      onClick={() => setOccupants({ ...occupants, [key]: occupants[key] + 1 })}
                      className="h-8 w-8 rounded-full border border-[rgba(0,0,0,0.4)] text-ink flex items-center justify-center text-lg hover:border-ink transition-colors cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  className="rounded-full bg-ink text-white px-6 py-2 text-sm font-semibold hover:bg-ink/90 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* -- PANEL: WHAT (description) ---------------------------------- */}
          {activePanel === "what" && (
            <div
              className="search-panel-enter absolute z-50 bg-white rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] border border-surface-border w-full sm:w-[420px] sm:right-0"
              style={{ top: "calc(100% + 6px)" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="p-5">
                <textarea
                  autoFocus
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ask for specific things like a bright, modern kitchen and a yard."
                  className="w-full resize-none rounded-xl border border-surface-border px-4 py-3 text-[15px] text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
                <p className="mt-2 mb-2 text-sm font-semibold">Suggested descriptions</p>
                <div
                  ref={whatSuggestionsRef}
                  className="relative flex flex-col gap-1"
                  onMouseLeave={() => clearHighlight(whatHighlightRef2)}
                >
                  <div
                    ref={whatHighlightRef2}
                    className="absolute inset-x-0 rounded-xl bg-surface-alt pointer-events-none"
                    style={{ top: 0, height: 0, opacity: 0 }}
                  />
                  {SUGGESTED_DESCRIPTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setDescription(s);
                        setActivePanel(null);
                      }}
                      onMouseEnter={(e) =>
                        applyHighlight(whatHighlightRef2, e.currentTarget.offsetTop, e.currentTarget.offsetHeight)
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
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
