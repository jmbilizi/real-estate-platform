'use client';

import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { Media } from '@/lib/types';
import ListingImage from '@/components/listing/ListingImage';
import { resolveTourEntry } from '@/lib/tour-url';

/**
 * The detail page's photo gallery.
 *
 * Takes the wire contract's `Media[]` directly — `{url, altText}` objects, never a bare URL array.
 * `altText` is what reaches each `<img>`'s accessible name; the listing title is never substituted
 * in, because that would put marketing copy into the accessible name of a photo it does not
 * describe. An empty array renders the branded placeholder via `ListingImage` rather than nothing.
 */
export type GalleryPhoto = Media & { caption?: string | null };

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a full-screen viewer needs from the page. Focus moves to `initialRef` on open and returns
 * to the opener on close. The page does not scroll behind it. Escape closes it, and `onKey` sees
 * every other key. The viewer renders inside the listing modal, so Escape and Tab stop here: the
 * modal's own window handlers would otherwise close the whole listing or trap Tab in the wrong
 * place. With `trapTab` the hook cycles Tab inside `dialogRef`.
 */
function useViewerChrome({
  dialogRef,
  initialRef,
  onClose,
  trapTab = false,
  onKey,
}: {
  dialogRef: RefObject<HTMLElement | null>;
  initialRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  trapTab?: boolean;
  onKey?: (e: KeyboardEvent) => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    const prevPadding = html.style.paddingRight;
    html.style.paddingRight = `${window.innerWidth - html.clientWidth}px`;
    html.style.overflow = 'hidden';
    initialRef.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        e.stopPropagation();
        const dialog = dialogRef.current;
        if (!trapTab || !dialog) return;
        const stops = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (stops.length === 0) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        const active = document.activeElement;
        if (!dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      onKeyRef.current?.(e);
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      html.style.overflow = prevOverflow;
      html.style.paddingRight = prevPadding;
      if (opener && document.contains(opener)) opener.focus();
    };
    // The refs are stable. `trapTab` is fixed per viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Full-screen tour dialog. Focus moves to Close on open, Tab cycles Close and the iframe, the page
 * does not scroll behind it, and focus returns to the opener on close. A sentinel after the iframe
 * catches Tab leaving it, because key events inside a cross-origin frame never reach this page.
 */
function TourViewer({ href, onClose }: { href: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  useViewerChrome({ dialogRef, initialRef: closeRef, onClose });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="3D tour"
      className="fixed inset-0 z-[100] flex flex-col bg-ink/95"
    >
      <div className="flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault();
              frameRef.current?.focus();
            }
          }}
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/10"
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
        <p className="text-sm font-medium">3D tour</p>
        <span className="w-16" />
      </div>
      <iframe
        ref={frameRef}
        src={href}
        title="3D tour"
        className="min-h-0 w-full flex-1 border-0 bg-white"
        allow="autoplay; fullscreen; web-share; xr-spatial-tracking"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        referrerPolicy="no-referrer"
      />
      <div tabIndex={0} aria-hidden="true" onFocus={() => closeRef.current?.focus()} />
    </div>
  );
}

/** Full-screen photo viewer. Same focus, Tab and scroll-lock behavior as `TourViewer`. */
function PhotoViewer({
  media,
  index,
  onIndex,
  onClose,
}: {
  media: GalleryPhoto[];
  index: number;
  onIndex: (next: (prev: number) => number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = media.length;
  const next = useCallback(() => onIndex((p) => (p + 1) % count), [onIndex, count]);
  const prev = useCallback(() => onIndex((p) => (p - 1 + count) % count), [onIndex, count]);
  useViewerChrome({
    dialogRef,
    initialRef: closeRef,
    onClose,
    trapTab: true,
    onKey: (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    },
  });

  const navButton =
    'flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-30';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[100] flex flex-col bg-ink/95"
    >
      <div className="flex items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <button ref={closeRef} type="button" onClick={onClose} className={navButton}>
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
          {index + 1} / {count}
        </p>
        <span className="w-16" />
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-4">
        <ListingImage
          media={media[index]}
          className="max-h-full max-w-full rounded-xl object-contain"
          backdrop={false}
        />
      </div>
      {/* Bottom bar: prev/next arrows and the photo caption, when the photo has one. */}
      <div className="flex items-center justify-between px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 text-white">
        <button
          type="button"
          onClick={prev}
          disabled={count <= 1}
          className={navButton}
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
        <p
          className="min-w-0 flex-1 px-3 text-center text-sm text-white/90"
          data-testid="gallery-caption"
        >
          {media[index]?.caption ?? ''}
        </p>
        <button
          type="button"
          onClick={next}
          disabled={count <= 1}
          className={navButton}
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
  );
}

export default function PropertyGallery({
  media,
  tourUrl,
  children,
}: {
  media: GalleryPhoto[];
  /** The unbranded virtual tour URL. The "3D tour" entry shows only when it passes `resolveTourEntry`. */
  tourUrl?: string | null;
  /** Overlay slot inside the gallery frame, for example a status badge. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [swipeIdx, setSwipeIdx] = useState(0);
  const [tourOpenHref, setTourOpenHref] = useState<string | null>(null);
  const tour = resolveTourEntry(tourUrl);
  const trackRef = useRef<HTMLDivElement>(null);

  const onSwipeScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setSwipeIdx(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  // A new photo set while the gallery stays mounted starts at the first photo again. Keyed on the
  // urls, so a parent that rebuilds the same array does not reset the counter.
  const mediaKey = media.map((m) => m.url).join('|');
  useEffect(() => {
    setSwipeIdx(0);
    setActiveIdx(0);
    if (trackRef.current) trackRef.current.scrollLeft = 0;
  }, [mediaKey]);

  const badgeOverlay = children ? (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)]">
      {children}
    </div>
  ) : null;

  const tourPill =
    'absolute bottom-3 left-3 z-10 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-ink shadow-card md:bottom-4 md:left-4 md:min-h-0 md:text-sm';
  const tourIcon = (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
      />
    </svg>
  );
  const tourEntry = !tour ? null : tour.mode === 'frame' ? (
    <button type="button" onClick={() => setTourOpenHref(tour.href)} className={tourPill}>
      {tourIcon}3D tour
    </button>
  ) : (
    <a href={tour.href} target="_blank" rel="noopener noreferrer" className={tourPill}>
      {tourIcon}3D tour<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  const tourViewer =
    tour?.mode === 'frame' && tourOpenHref === tour.href ? (
      <TourViewer href={tour.href} onClose={() => setTourOpenHref(null)} />
    ) : null;

  if (media.length === 0) {
    return (
      <div className="relative">
        <ListingImage
          media={null}
          sizeHint="detail"
          className="aspect-video w-full overflow-hidden rounded-2xl md:h-[480px]"
        />
        {badgeOverlay}
        {tourEntry}
        {tourViewer}
      </div>
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
        {/* Mobile: swipeable strip in the same aspect-[4/3] frame, so the skeleton still fits. */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-surface-soft md:hidden">
          <div
            ref={trackRef}
            onScroll={onSwipeScroll}
            data-testid="gallery-swipe"
            className="scrollbar-none flex h-full w-full snap-x snap-mandatory overflow-x-auto"
          >
            {media.map((photo, i) => (
              <button
                type="button"
                key={i}
                onClick={() => {
                  setActiveIdx(i);
                  setOpen(true);
                }}
                aria-label={`View photo ${i + 1} of ${media.length}`}
                className="block h-full w-full shrink-0 snap-center"
              >
                <ListingImage media={photo} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
          <span
            data-testid="gallery-swipe-counter"
            className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold tabular-nums text-ink shadow-card"
          >
            {Math.min(swipeIdx, media.length - 1) + 1} / {media.length}
          </span>
        </div>

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
            <ListingImage media={media[0]} className="h-full w-full object-contain" />
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
              <ListingImage media={media[mediaIdx]} className="h-full w-full object-contain" />
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
        {badgeOverlay}
        {tourEntry}
      </div>
      {tourViewer}

      {open && (
        <PhotoViewer
          media={media}
          index={activeIdx}
          onIndex={setActiveIdx}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
