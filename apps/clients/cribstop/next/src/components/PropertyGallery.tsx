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

/** The iframe attributes every tour frame shares. A tour needs scripts, but never top navigation. */
const TOUR_FRAME_PROPS = {
  title: '3D tour',
  allow: 'autoplay; fullscreen; web-share; xr-spatial-tracking',
  allowFullScreen: true,
  sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation',
  referrerPolicy: 'no-referrer',
} as const;

/** The tour a gallery plays: the iframe `src` and the page URL for a new tab. */
type GalleryTour = { src: string; href: string };

/**
 * The tour slide in the full-screen viewer. It mounts only while its slide is active, so a heavy
 * tour never loads for a visitor who does not open it. The link stays for a host that fails to
 * load. Key events inside the cross-origin frame never reach this page. Tab leaves the frame for
 * the Prev button, which follows it in the DOM.
 */
function TourFrame({ tour }: { tour: GalleryTour }) {
  return (
    <div className="flex h-full w-full flex-col gap-2" data-testid="gallery-tour-slide">
      <iframe
        {...TOUR_FRAME_PROPS}
        src={tour.src}
        className="min-h-0 w-full flex-1 rounded-xl border-0 bg-white"
      />
      <a
        href={tour.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center self-center rounded-full px-3 py-1.5 text-sm font-medium text-white underline hover:bg-white/10"
      >
        Open the tour in a new tab<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

/**
 * Full-screen viewer for the photos and the tour slide. `index` counts slides. `tourSlide` is the
 * slide index of the tour, or -1 for none, and the photos fill every other slide in order.
 */
function PhotoViewer({
  media,
  tour,
  tourSlide,
  index,
  onIndex,
  onClose,
}: {
  media: GalleryPhoto[];
  tour: GalleryTour | null;
  tourSlide: number;
  index: number;
  onIndex: (next: (prev: number) => number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = media.length + (tour ? 1 : 0);
  const onTour = tour !== null && index === tourSlide;
  const photo = onTour ? null : media[tour && index > tourSlide ? index - 1 : index];
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
        {onTour ? (
          <TourFrame tour={tour} />
        ) : (
          <ListingImage
            media={photo}
            className="max-h-full max-w-full rounded-xl object-contain"
            backdrop={false}
          />
        )}
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
          {photo?.caption ?? ''}
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

/**
 * The tour slide in the phone swipe strip. The iframe loads only while the slide is in view. A
 * cross-origin frame takes every touch, so a visitor could not swipe back out of it. The frame
 * ignores touches until the visitor taps to explore, and Done hands the swipe back.
 */
function StripTourSlide({ tour, active }: { tour: GalleryTour; active: boolean }) {
  const [exploring, setExploring] = useState(false);
  useEffect(() => {
    if (!active) setExploring(false);
  }, [active]);

  return (
    <div
      className="relative h-full w-full shrink-0 snap-center bg-ink"
      data-testid="gallery-swipe-tour"
    >
      {active && (
        <iframe
          {...TOUR_FRAME_PROPS}
          src={tour.src}
          className={`h-full w-full border-0 bg-white ${exploring ? '' : 'pointer-events-none'}`}
        />
      )}
      {active && !exploring && (
        <button
          type="button"
          onClick={() => setExploring(true)}
          className="absolute inset-0 flex items-center justify-center bg-ink/10"
        >
          <span className="rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-ink shadow-card">
            Tap to explore the 3D tour
          </span>
        </button>
      )}
      {active && exploring && (
        <button
          type="button"
          onClick={() => setExploring(false)}
          className="absolute right-3 top-3 min-h-11 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-ink shadow-card"
        >
          Done
        </button>
      )}
      {!active && (
        <div className="flex h-full w-full items-center justify-center text-sm font-medium text-white/90">
          3D tour
        </div>
      )}
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
  const entry = resolveTourEntry(tourUrl);
  // The tour plays as a slide right after the cover photo. The cover stays the first thing a
  // visitor sees and the photo counter still starts at the photo. A listing with no photo has
  // the tour alone.
  const tour: GalleryTour | null =
    entry?.mode === 'frame' && entry.embedSrc ? { src: entry.embedSrc, href: entry.href } : null;
  const tourSlide = !tour ? -1 : media.length === 0 ? 0 : 1;
  const slideCount = media.length + (tour ? 1 : 0);
  /** The slide that shows photo `i`. Photos after the tour slide shift up by one. */
  const slideOfPhoto = (i: number) => (tour && i >= tourSlide ? i + 1 : i);
  const photoOfSlide = (slide: number) => (tour && slide > tourSlide ? slide - 1 : slide);
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
  /** On a phone the strip plays the tour in place. Elsewhere the viewer opens on the tour slide. */
  const showTour = () => {
    const track = trackRef.current;
    const phone =
      typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 768px)').matches;
    if (phone && track) {
      setSwipeIdx(tourSlide);
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: tourSlide * track.clientWidth, behavior: 'smooth' });
      } else {
        track.scrollLeft = tourSlide * track.clientWidth;
      }
      return;
    }
    setActiveIdx(tourSlide);
    setOpen(true);
  };
  const tourEntry = !entry ? null : tour ? (
    <button type="button" onClick={showTour} className={tourPill}>
      {tourIcon}3D tour
    </button>
  ) : (
    <a href={entry.href} target="_blank" rel="noopener noreferrer" className={tourPill}>
      {tourIcon}3D tour
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.5 6H18v4.5M18 6l-7.5 7.5M10 6H6.5A1.5 1.5 0 005 7.5v10A1.5 1.5 0 006.5 19h10a1.5 1.5 0 001.5-1.5V14"
        />
      </svg>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  const viewer = open ? (
    <PhotoViewer
      media={media}
      tour={tour}
      tourSlide={tourSlide}
      index={Math.min(activeIdx, slideCount - 1)}
      onIndex={setActiveIdx}
      onClose={() => setOpen(false)}
    />
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
        {viewer}
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
            {Array.from({ length: slideCount }, (_, slide) =>
              tour && slide === tourSlide ? (
                <StripTourSlide key="tour" tour={tour} active={swipeIdx === tourSlide} />
              ) : (
                <button
                  type="button"
                  key={slide}
                  onClick={() => {
                    setActiveIdx(slide);
                    setOpen(true);
                  }}
                  aria-label={`View photo ${photoOfSlide(slide) + 1} of ${media.length}`}
                  className="block h-full w-full shrink-0 snap-center"
                >
                  <ListingImage
                    media={media[photoOfSlide(slide)]}
                    className="h-full w-full object-contain"
                  />
                </button>
              ),
            )}
          </div>
          <span
            data-testid="gallery-swipe-counter"
            className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold tabular-nums text-ink shadow-card"
          >
            {Math.min(swipeIdx, slideCount - 1) + 1} / {slideCount}
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
                setActiveIdx(slideOfPhoto(mediaIdx));
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
      {viewer}
    </>
  );
}
