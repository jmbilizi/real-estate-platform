"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function HeaderSearchPill({ className = "" }: { className?: string }) {
  const [value, setValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (val: string) => {
    setValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setSuggestions([]);
      setIsOpen(true);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(val)}`);
        if (res.ok) setSuggestions(await res.json());
        else setSuggestions([]);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
        setIsOpen(true);
      }
    }, 300);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsOpen(false);
    router.push(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : "/search");
  };

  const handleSelect = (s: any) => {
    const label = s.display_name?.split(",").slice(0, 2).join(",").trim() || "";
    setValue(label);
    setIsOpen(false);
    setSuggestions([]);
    router.push(`/search?q=${encodeURIComponent(s.display_name || label)}`);
  };

  const hasDropdown = isOpen && value.trim().length >= 2;

  return (
    <div ref={wrapperRef} className={`relative w-full ${className}`}>
      <form
        onSubmit={handleSubmit}
        className={`flex items-center bg-white transition-all duration-150 ${
          hasDropdown && suggestions.length > 0
            ? "rounded-t-full border border-[#dfe1e5] border-b-0 shadow-none"
            : "rounded-full border border-surface-border shadow-card hover:shadow-md"
        }`}
      >
        <span className="ml-3.5 flex-shrink-0 text-ink-muted">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Search homes…"
          className="flex-1 bg-transparent py-2.5 px-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          className="m-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      </form>

      {/* Suggestions dropdown */}
      {hasDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 overflow-hidden rounded-b-2xl border border-t-0 border-[#dfe1e5] bg-white shadow-lg">
          {loading && <div className="px-4 py-3 text-sm text-ink-muted">Loading…</div>}
          {!loading && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-ink-muted">No locations found</div>
          )}
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink hover:bg-[#f8f9fa] transition-colors"
            >
              <svg className="h-4 w-4 flex-shrink-0 text-ink-muted" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
              <span className="truncate">{s.display_name?.split(",").slice(0, 3).join(", ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
