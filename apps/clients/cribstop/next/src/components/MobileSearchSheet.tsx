"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context";
import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";

// ─── Location helpers ────────────────────────────────────────────────────────

const STATE_ABBR: Record<string, string> = {
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

function formatLabel(loc: any): string {
  const a = loc.address || {};
  const city = a.city || a.town || a.village || a.hamlet || "";
  const state = a.state || "";
  const abbr = STATE_ABBR[state] || state || "";
  if (city && abbr) return `${city}, ${abbr}`;
  if (city) return city;
  return loc.display_name?.split(",").slice(0, 2).join(",").trim() || "";
}

async function fetchSuggestions(query: string): Promise<any[]> {
  if (!query || query.length < 2) return [];
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=6&countrycodes=us`,
      { headers: { Accept: "application/json", "User-Agent": "cribstop/1.0" } },
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

const MONTHS_LONG = [
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
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}
function firstDayOffset(y: number, m: number) {
  return new Date(y, m, 1).getDay();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MobileSearchSheet({ onClose }: { onClose: () => void }) {
  const { listingTab, setListingTab } = useApp();
  const router = useRouter();

  // Which card is expanded
  const [activeCard, setActiveCard] = useState<"where" | "when" | "who">("where");

  // Where state
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // When state
  const now = new Date();
  const [calMonth, setCalMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [moveInDate, setMoveInDate] = useState("");

  // Who state
  const [occupants, setOccupants] = useState({ adults: 0, children: 0, infants: 0, pets: 0 });

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Auto-focus input when where card is active
  useEffect(() => {
    if (activeCard === "where") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [activeCard]);

  // Debounced suggestions fetch
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim() || selected) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await fetchSuggestions(query);
      setSuggestions(results);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, selected]);

  const handleSelect = (loc: any) => {
    setSelected(loc);
    setQuery(formatLabel(loc));
    setSuggestions([]);
    setActiveCard("when");
  };

  const handleClear = () => {
    setQuery("");
    setSelected(null);
    setSuggestions([]);
    setMoveInDate("");
    setOccupants({ adults: 0, children: 0, infants: 0, pets: 0 });
    setActiveCard("where");
  };

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (selected) {
      params.set("q", formatLabel(selected));
      params.set("lat", String(selected.lat));
      params.set("lon", String(selected.lon));
    } else if (query.trim()) {
      params.set("q", query.trim());
    }
    params.set("type", listingTab === "for-rent" ? "for-rent" : "for-sale");
    if (moveInDate) params.set("moveIn", moveInDate);
    const total = occupants.adults + occupants.children;
    if (total > 0) params.set("guests", String(total));
    router.push(`/search?${params.toString()}`);
    onClose();
  };

  // Calendar nav
  const prevMonth = () =>
    setCalMonth((c) => {
      const m = c.month === 0 ? 11 : c.month - 1;
      const y = c.month === 0 ? c.year - 1 : c.year;
      return { year: y, month: m };
    });
  const nextMonth = () =>
    setCalMonth((c) => {
      const m = c.month === 11 ? 0 : c.month + 1;
      const y = c.month === 11 ? c.year + 1 : c.year;
      return { year: y, month: m };
    });

  const occupantTotal = occupants.adults + occupants.children;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const moveInLabel = moveInDate
    ? (() => {
        const p = moveInDate.split("-");
        return `${MONTHS_SHORT[+p[1] - 1]} ${+p[2]}, ${p[0]}`;
      })()
    : "";

  const whoLabel =
    occupantTotal > 0
      ? `${occupantTotal} guest${occupantTotal !== 1 ? "s" : ""}${occupants.infants ? `, ${occupants.infants} infant${occupants.infants !== 1 ? "s" : ""}` : ""}${occupants.pets ? `, ${occupants.pets} pet${occupants.pets !== 1 ? "s" : ""}` : ""}`
      : "";

  return (
    <div className="fixed inset-0 z-[60] bg-[#F7F7F7] flex flex-col" style={{ animation: "mss-in 220ms ease both" }}>
      <style>
        {
          "@keyframes mss-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }"
        }
      </style>

      {/* ── Top bar: tabs + close ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
        <div className="flex gap-1.5">
          {(["for-sale", "for-rent"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setListingTab(tab)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors duration-150 ${
                listingTab === tab
                  ? "bg-ink text-white shadow-sm"
                  : "bg-white text-ink-muted border border-surface-border hover:bg-surface-soft"
              }`}
            >
              {tab === "for-sale" ? "Buy" : "Rent"}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="h-8 w-8 flex items-center justify-center rounded-full bg-white border border-surface-border shadow-sm"
          aria-label="Close search"
        >
          <X className="h-[15px] w-[15px] text-ink" />
        </button>
      </div>

      {/* ── Cards ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2.5">
        {/* WHERE card */}
        <div
          className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
            activeCard === "where" ? "ring-2 ring-ink" : "cursor-pointer"
          }`}
          onClick={() => activeCard !== "where" && setActiveCard("where")}
        >
          <div className="px-5 pt-4 pb-4">
            <p className="text-[11px] font-bold text-ink uppercase tracking-wider">Where?</p>
            {activeCard === "where" ? (
              <div className="mt-3">
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted pointer-events-none" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setSelected(null);
                    }}
                    placeholder="City, neighborhood or ZIP"
                    className="w-full pl-9 pr-9 py-2.5 border border-[rgba(0,0,0,0.15)] rounded-xl text-[14px] text-ink bg-[#F7F7F7] focus:outline-none focus:ring-2 focus:ring-ink focus:bg-white transition-colors"
                  />
                  {query && (
                    <button
                      onClick={() => {
                        setQuery("");
                        setSelected(null);
                        setSuggestions([]);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded-full bg-ink-muted/20"
                    >
                      <X className="h-3 w-3 text-ink-muted" />
                    </button>
                  )}
                </div>
                {suggestions.length > 0 && (
                  <ul className="mt-2 space-y-px">
                    {suggestions.map((s, i) => (
                      <li key={i}>
                        <button
                          onClick={() => handleSelect(s)}
                          className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-surface-soft flex items-start gap-3"
                        >
                          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-soft">
                            <MapPin className="h-3.5 w-3.5 text-ink-muted" />
                          </span>
                          <div className="min-w-0">
                            <span className="text-[14px] font-medium text-ink block leading-snug">
                              {formatLabel(s)}
                            </span>
                            <span className="text-[12px] text-ink-muted block leading-snug truncate">
                              {s.display_name?.split(",").slice(1, 3).join(",").trim()}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!query && (
                  <p className="mt-3 text-[13px] text-ink-muted">
                    Search any city, ZIP code or neighborhood in the US.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[14px] text-ink-muted mt-1">
                {selected ? formatLabel(selected) : query || "Anywhere"}
              </p>
            )}
          </div>
        </div>

        {/* WHEN card */}
        <div
          className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
            activeCard === "when" ? "ring-2 ring-ink" : "cursor-pointer"
          }`}
          onClick={() => activeCard !== "when" && setActiveCard("when")}
        >
          <div className="px-5 pt-4 pb-4">
            <p className="text-[11px] font-bold text-ink uppercase tracking-wider">When?</p>
            {activeCard === "when" ? (
              <div className="mt-3">
                {/* Month nav */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      prevMonth();
                    }}
                    className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-surface-soft text-ink-muted"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-semibold text-ink">
                    {MONTHS_LONG[calMonth.month]} {calMonth.year}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      nextMonth();
                    }}
                    className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-surface-soft text-ink-muted"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                {/* Day headers */}
                <div className="grid grid-cols-7 mb-1">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                    <span key={d} className="text-center text-[11px] text-ink-muted font-medium py-1">
                      {d}
                    </span>
                  ))}
                </div>
                {/* Days */}
                <div className="grid grid-cols-7 gap-y-1">
                  {Array.from({ length: firstDayOffset(calMonth.year, calMonth.month) }).map((_, i) => (
                    <span key={`e${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth(calMonth.year, calMonth.month) }).map((_, i) => {
                    const d = i + 1;
                    const dateStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const date = new Date(dateStr);
                    const isSelected = moveInDate === dateStr;
                    const isPast = date < today;
                    return (
                      <button
                        key={d}
                        disabled={isPast}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMoveInDate(isSelected ? "" : dateStr);
                          if (!isSelected) setActiveCard("who");
                        }}
                        className={`aspect-square flex items-center justify-center rounded-full text-[13px] transition-colors mx-auto w-9 ${
                          isSelected
                            ? "bg-ink text-white font-semibold"
                            : isPast
                              ? "text-ink-muted/30 cursor-not-allowed"
                              : "hover:bg-surface-soft text-ink"
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                {moveInDate && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoveInDate("");
                    }}
                    className="mt-3 text-[13px] text-ink-muted underline underline-offset-2"
                  >
                    Clear date
                  </button>
                )}
              </div>
            ) : (
              <p className="text-[14px] text-ink-muted mt-1">{moveInLabel || "Anytime"}</p>
            )}
          </div>
        </div>

        {/* WHO card */}
        <div
          className={`bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.07)] transition-all duration-200 overflow-hidden ${
            activeCard === "who" ? "ring-2 ring-ink" : "cursor-pointer"
          }`}
          onClick={() => activeCard !== "who" && setActiveCard("who")}
        >
          <div className="px-5 pt-4 pb-4">
            <p className="text-[11px] font-bold text-ink uppercase tracking-wider">Who?</p>
            {activeCard === "who" ? (
              <div className="mt-3 space-y-4">
                {(
                  [
                    { key: "adults", label: "Adults", sub: "Ages 13+" },
                    { key: "children", label: "Children", sub: "Ages 2–12" },
                    { key: "infants", label: "Infants", sub: "Under 2" },
                    { key: "pets", label: "Pets", sub: "Bringing a service animal?" },
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
                          setOccupants((o) => ({ ...o, [key]: Math.max(0, o[key] - 1) }));
                        }}
                        disabled={occupants[key] === 0}
                        className="h-8 w-8 rounded-full border border-surface-border flex items-center justify-center text-lg text-ink-muted hover:border-ink hover:text-ink disabled:opacity-30 transition-colors"
                      >
                        –
                      </button>
                      <span className="w-5 text-center text-[14px] font-medium text-ink">{occupants[key]}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOccupants((o) => ({ ...o, [key]: o[key] + 1 }));
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
              <p className="text-[14px] text-ink-muted mt-1">{whoLabel || "Add occupants"}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom bar ───────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 bg-white border-t border-surface-border shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <button onClick={handleClear} className="text-[14px] font-semibold text-ink underline underline-offset-2">
          Clear all
        </button>
        <button
          onClick={handleSearch}
          className="flex items-center gap-2 h-12 px-7 rounded-full bg-brand text-white font-semibold text-[14px] hover:bg-brand/90 active:scale-95 transition-transform shadow-md"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search homes
        </button>
      </div>
    </div>
  );
}
