'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Media } from '@/lib/types';
import ListingImage from '@/components/listing/ListingImage';

/**
 * The detail page's photo gallery.
 *
 * Takes the wire contract's `Media[]` directly — `{url, altText}` objects, never a bare URL array.
 * `altText` is what reaches each `<img>`'s accessible name; the listing title is never substituted
 * in, because that would put marketing copy into the accessible name of a photo it does not
 * describe. An empty array renders the branded placeholder via `ListingImage` rather than nothing.
 */
export default function PropertyGallery({ media }: { media: Media[] }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowRight') setActiveIdx((p) => (p + 1) % media.length);
      if (e.key === 'ArrowLeft') setActiveIdx((p) => (p - 1 + media.length) % media.length);
    },
    [open, media.length],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  if (media.length === 0) {
    return (
      <ListingImage
        media={null}
        sizeHint="detail"
        className="aspect-video w-full overflow-hidden rounded-2xl md:h-[480px]"
      />
    );
  }

  /**
   * The mosaic needs 5 tiles, so a listing with fewer photos repeats them.
   *
   * Padding is by **index into `media`**, not by copying the objects: the tile's click handler and
   * its accessible label both have to refer to a real photo. Padding with values and then deriving
   * the lightbox index from the tile's position meant the 5th tile of a 4-photo listing opened at
   * `media[4]` — previously a broken `<img src={undefined}>`, and a label reading "View photo 5" of
   * 4 photos.
   */
  const tileIndices = Array.from({ length: 5 }, (_, i) => i % media.length);

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
          aria-label={`View all ${media.length} photos`}
          className="relative block aspect-video w-full overflow-hidden rounded-2xl bg-surface-soft md:hidden"
        >
          <ListingImage media={media[0]} className="h-full w-full object-cover" />
          <span className="absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-ink shadow-card">
            See all {media.length} {media.length === 1 ? 'photo' : 'photos'}
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
            aria-label="View primary photo"
            className="relative col-span-2 row-span-2 overflow-hidden bg-surface-soft transition hover:brightness-95"
          >
            <ListingImage media={media[0]} className="h-full w-full object-cover" />
          </button>
          {tileIndices.slice(1).map((mediaIdx, tileIdx) => (
            <button
              type="button"
              key={tileIdx}
              onClick={() => {
                setActiveIdx(mediaIdx);
                setOpen(true);
              }}
              aria-label={`View photo ${mediaIdx + 1} of ${media.length}`}
              className="relative overflow-hidden bg-surface-soft transition hover:brightness-95"
            >
              <ListingImage media={media[mediaIdx]} className="h-full w-full object-cover" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setActiveIdx(0);
              setOpen(true);
            }}
            className="absolute bottom-4 right-4 hidden items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink shadow-card transition hover:shadow-card md:inline-flex"
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
            Show all {media.length} photos
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
              {activeIdx + 1} / {media.length}
            </p>
            <span className="w-16" />
          </div>
          <div className="relative flex flex-1 items-center justify-center px-4 py-4 min-h-0">
            <ListingImage
              media={media[activeIdx]}
              className="max-h-full max-w-full rounded-xl object-contain"
            />
          </div>
          {/* Bottom bar — mirrors top bar height, houses prev/next arrows */}
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <button
              onClick={() => setActiveIdx((p) => (p === 0 ? media.length - 1 : p - 1))}
              disabled={media.length <= 1}
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
              {activeIdx + 1} / {media.length}
            </p>
            <button
              onClick={() => setActiveIdx((p) => (p === media.length - 1 ? 0 : p + 1))}
              disabled={media.length <= 1}
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
