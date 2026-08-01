'use client';

import { useCallback, useEffect, useState } from 'react';

export default function PropertyGallery({ images, title }: { images: string[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight') setActiveIdx((p) => (p + 1) % images.length);
      if (e.key === 'ArrowLeft') setActiveIdx((p) => (p - 1 + images.length) % images.length);
    },
    [open, images.length],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  if (!images.length) return null;

  // Need at least 5 tiles for the mosaic — pad by repeating
  const tiles =
    images.length >= 5
      ? images.slice(0, 5)
      : [...images, ...images, ...images, ...images, ...images].slice(0, 5);

  return (
    <>
      {/* Mosaic — Airbnb-style: 1 big left + 2x2 grid right */}
      <div className="relative">
        {/* Mobile: single image */}
        <button
          type="button"
          onClick={() => {
            setActiveIdx(0);
            setOpen(true);
          }}
          className="relative block aspect-video w-full overflow-hidden rounded-2xl bg-surface-soft md:hidden"
        >
          {}
          <img src={tiles[0]} alt={title} className="h-full w-full object-cover" />
          <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-ink shadow-card">
            See all {images.length} photos
          </span>
        </button>

        {/* Desktop: mosaic grid */}
        <div className="hidden md:grid md:h-[480px] md:grid-cols-4 md:grid-rows-2 md:gap-2 md:overflow-hidden md:rounded-2xl">
          <button
            type="button"
            onClick={() => {
              setActiveIdx(0);
              setOpen(true);
            }}
            className="relative col-span-2 row-span-2 overflow-hidden bg-surface-soft transition hover:brightness-95"
          >
            {}
            <img src={tiles[0]} alt={`${title} – primary`} className="h-full w-full object-cover" />
          </button>
          {tiles.slice(1, 5).map((src, i) => (
            <button
              type="button"
              key={i}
              onClick={() => {
                setActiveIdx(i + 1);
                setOpen(true);
              }}
              className="relative overflow-hidden bg-surface-soft transition hover:brightness-95"
            >
              {}
              <img src={src} alt={`${title} – ${i + 2}`} className="h-full w-full object-cover" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setActiveIdx(0);
              setOpen(true);
            }}
            className="absolute bottom-4 right-4 hidden items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-semibold text-ink shadow-card transition hover:shadow-card md:inline-flex"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h6v6H4V6zm10 0h6v6h-6V6zM4 16h6v6H4v-6zm10 0h6v6h-6v-6z"
              />
            </svg>
            Show all {images.length} photos
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-ink/95">
          <div className="flex items-center justify-between p-4 text-white">
            <button
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/10"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close
            </button>
            <p className="text-sm font-medium tabular-nums">
              {activeIdx + 1} / {images.length}
            </p>
            <span className="w-16" />
          </div>
          <div className="relative flex flex-1 items-center justify-center px-4 py-4 min-h-0">
            {}
            <img
              src={images[activeIdx]}
              alt={`${title} – photo ${activeIdx + 1}`}
              className="max-h-full max-w-full rounded-xl object-contain"
            />
          </div>
          {/* Bottom bar — mirrors top bar height, houses prev/next arrows */}
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <button
              onClick={() => setActiveIdx((p) => (p === 0 ? images.length - 1 : p - 1))}
              disabled={images.length <= 1}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-30"
              aria-label="Previous"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Prev
            </button>
            <p className="text-sm font-medium tabular-nums">
              {activeIdx + 1} / {images.length}
            </p>
            <button
              onClick={() => setActiveIdx((p) => (p === images.length - 1 ? 0 : p + 1))}
              disabled={images.length <= 1}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-30"
              aria-label="Next"
            >
              Next
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
