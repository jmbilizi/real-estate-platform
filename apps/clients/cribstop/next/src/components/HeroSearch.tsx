"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const categories = [
  { label: "All homes", icon: "🏠", params: "" },
  { label: "For sale", icon: "🪧", params: "listingType=sale" },
  { label: "For rent", icon: "🔑", params: "listingType=rent" },
  { label: "Open houses", icon: "🚪", params: "openHouse=true" },
  { label: "Luxury", icon: "💎", params: "minPrice=1000000" },
  { label: "New build", icon: "🏗️", params: "newConstruction=true" },
  { label: "Condos", icon: "🏢", params: "propertyType=Condo" },
  { label: "Townhomes", icon: "🏘️", params: "propertyType=Townhome" },
  { label: "Waterfront", icon: "🌊", params: "waterfront=true" },
  { label: "Pet friendly", icon: "🐾", params: "petFriendly=true" },
  { label: "Investment", icon: "📈", params: "propertyType=Multi-Family" },
];

const PRICE_RANGES = [
  { label: "Any price", min: "", max: "" },
  { label: "Under $500k", min: "", max: "500000" },
  { label: "$500k – $1M", min: "500000", max: "1000000" },
  { label: "$1M – $2M", min: "1000000", max: "2000000" },
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

export default function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [priceIdx, setPriceIdx] = useState(0);
  const [bedsIdx, setBedsIdx] = useState(0);
  const [mode, setMode] = useState<"buy" | "rent">("buy");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("listingType", mode === "buy" ? "sale" : "rent");
    const price = PRICE_RANGES[priceIdx];
    if (price.min) params.set("minPrice", price.min);
    if (price.max) params.set("maxPrice", price.max);
    const beds = BED_OPTIONS[bedsIdx].value;
    if (beds) params.set("beds", beds);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <section className="relative isolate overflow-hidden">
      {/* Background photograph */}
      <div
        className="absolute inset-0 -z-10 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1613977257363-707ba9348227?w=2400&auto=format&fit=crop&q=80')",
        }}
      />
      {/* Soft gradient overlay */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/35 via-ink/55 to-ink/75" />

      <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-20 sm:px-6 sm:pb-14 sm:pt-28 lg:pb-20 lg:pt-36">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Brokered by Real Broker LLC
          </span>
          <h1 className="mt-6 font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-white drop-shadow-sm sm:text-5xl lg:text-[4rem]">
            Find your next
            <br className="hidden sm:block" />
            <span className="text-brand-200"> home, beautifully.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-white/85 sm:text-lg">
            Premium homes for sale and rent across the DMV. Search confidently with verified Bright MLS listings.
          </p>
        </div>

        {/* Buy / Rent toggle */}
        <div className="mt-10 flex justify-center">
          <div className="inline-flex rounded-full bg-white/15 p-1 ring-1 ring-white/25 backdrop-blur">
            {(["buy", "rent"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-full px-7 py-2 text-sm font-semibold transition ${
                  mode === m ? "bg-white text-ink shadow" : "text-white/85 hover:text-white"
                }`}
              >
                {m === "buy" ? "Buy" : "Rent"}
              </button>
            ))}
          </div>
        </div>

        {/* Segmented search bar — Airbnb-inspired */}
        <form
          onSubmit={handleSearch}
          className="mx-auto mt-5 flex max-w-3xl flex-col divide-y divide-surface-border rounded-3xl bg-white p-2 shadow-pop ring-1 ring-black/5 sm:flex-row sm:items-stretch sm:divide-x sm:divide-y-0 sm:rounded-full sm:py-1.5 sm:pl-2 sm:pr-1.5"
        >
          {/* Where */}
          <label className="group flex-1 cursor-text px-5 py-2 transition hover:bg-surface-alt/50 sm:rounded-full">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-ink">Where</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city, ZIP, or neighborhood"
              className="mt-0.5 w-full bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            />
          </label>

          {/* Price */}
          <label className="group flex cursor-pointer items-center px-5 py-2 transition hover:bg-surface-alt/50 sm:rounded-full">
            <div className="flex-1 min-w-[120px]">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-ink">Price</span>
              <select
                value={priceIdx}
                onChange={(e) => setPriceIdx(Number(e.target.value))}
                className="mt-0.5 w-full appearance-none bg-transparent pr-2 text-sm text-ink-muted focus:outline-none"
              >
                {PRICE_RANGES.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </label>

          {/* Beds */}
          <label className="group flex cursor-pointer items-center px-5 py-2 transition hover:bg-surface-alt/50 sm:rounded-full">
            <div className="flex-1 min-w-[100px]">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-ink">Beds</span>
              <select
                value={bedsIdx}
                onChange={(e) => setBedsIdx(Number(e.target.value))}
                className="mt-0.5 w-full appearance-none bg-transparent pr-2 text-sm text-ink-muted focus:outline-none"
              >
                {BED_OPTIONS.map((b, i) => (
                  <option key={b.label} value={i}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </label>

          {/* Search button */}
          <div className="flex items-center px-2 pt-2 sm:px-0 sm:pt-0">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 sm:w-auto"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </button>
          </div>
        </form>

        {/* Trust strip */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/85 sm:mt-10">
          {[
            ["12,400+", "active listings"],
            ["DC · MD · VA", "coverage"],
            ["Daily", "Bright MLS updates"],
          ].map(([big, small]) => (
            <span key={big} className="flex items-baseline gap-1.5">
              <span className="font-display text-base font-bold text-white">{big}</span>
              <span className="text-white/70">{small}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Category strip — Airbnb-style icon-first navigation */}
      <div className="relative border-t border-surface-border bg-white">
        <div className="px-6 sm:px-10 lg:px-20">
          <div className="flex items-center gap-1 overflow-x-auto py-3 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => router.push(`/search${cat.params ? `?${cat.params}` : ""}`)}
                className="group flex flex-shrink-0 flex-col items-center gap-1 rounded-xl px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle transition hover:bg-surface-alt hover:text-ink"
              >
                <span className="text-2xl leading-none transition group-hover:scale-110">{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
