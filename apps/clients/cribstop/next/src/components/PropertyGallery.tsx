'use client';

import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import ToolbarIconButton, { BACK_ICON, FORWARD_ICON } from '@/components/ToolbarIconButton';
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
  // YouTube refuses an embed that sends no Referer (error 153), and a Vimeo domain-restricted
  // video needs one too. This policy sends the origin only, never the listing path.
  referrerPolicy: 'strict-origin-when-cross-origin',
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
        className="min-h-0 w-full flex-1 rounded-xl border border-surface-border bg-white"
      />
      <a
        href={tour.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center self-center rounded-full px-3 py-1.5 text-sm font-medium text-ink underline hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
  actions,
}: {
  media: GalleryPhoto[];
  tour: GalleryTour | null;
  tourSlide: number;
  index: number;
  onIndex: (next: (prev: number) => number) => void;
  onClose: () => void;
  /** Right slot of the top bar, for example Share and Save. */
  actions?: ReactNode;
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

  // A white ground like the rest of the site. Photos keep their own tones, and `object-contain`
  // never crops the Bright MLS watermark. Nothing overlays the photo.
  const ring =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[100] flex flex-col bg-white text-ink"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={`inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full border border-surface-border bg-white px-4 text-sm font-medium text-ink shadow-card transition-colors hover:bg-surface-soft ${ring}`}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close
        </button>
        <p className="text-sm font-medium tabular-nums">
          {index + 1} / {count}
        </p>
        <div className="flex items-center justify-self-end gap-1.5">{actions}</div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 py-2">
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
      {/* Bottom bar: prev/next and the photo caption, when the photo has one. */}
      <div className="flex items-center justify-between gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <ToolbarIconButton
          label="Previous"
          icon={BACK_ICON}
          onClick={prev}
          disabled={count <= 1}
          className="disabled:opacity-30"
        />
        <p
          className="min-w-0 flex-1 px-3 text-center text-sm text-ink-muted"
          data-testid="gallery-caption"
        >
          {photo?.caption ?? ''}
        </p>
        <ToolbarIconButton
          label="Next"
          icon={FORWARD_ICON}
          onClick={next}
          disabled={count <= 1}
          className="disabled:opacity-30"
        />
      </div>
    </div>
  );
}

function TourIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
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
}

function ExternalIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
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
  );
}

/**
 * The look of the tour tile: a listing photo with a centered circle and label. The overlay stays
 * centered, so it never covers the Bright MLS watermark at the bottom left of the photo. The
 * photo is `object-contain`, like every other tile, so nothing crops the watermark.
 */
function TourTileFace({
  photo,
  external = false,
}: {
  photo: GalleryPhoto | null;
  external?: boolean;
}) {
  return (
    <>
      <ListingImage media={photo} className="h-full w-full object-contain" />
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink/60 text-white">
          <TourIcon className="h-6 w-6" />
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-ink/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
          Explore 3D tour
          {external && <ExternalIcon className="h-3 w-3" />}
        </span>
      </span>
    </>
  );
}

/**
 * The tour slide in the phone swipe strip. It shows the tour tile until the visitor taps it. The
 * tap loads the iframe, so a swipe past the slide never loads a heavy tour. A cross-origin frame
 * takes every touch, so Done unloads it and hands the swipe back.
 */
function StripTourSlide({
  tour,
  photo,
  inView,
}: {
  tour: GalleryTour;
  photo: GalleryPhoto | null;
  inView: boolean;
}) {
  const [exploring, setExploring] = useState(false);
  useEffect(() => {
    if (!inView) setExploring(false);
  }, [inView]);

  return (
    <div
      className="relative h-full w-full shrink-0 snap-center bg-ink"
      data-testid="gallery-swipe-tour"
    >
      {exploring ? (
        <>
          <iframe
            {...TOUR_FRAME_PROPS}
            src={tour.src}
            className="h-full w-full border-0 bg-white"
          />
          <button
            type="button"
            onClick={() => setExploring(false)}
            className="absolute right-3 top-3 min-h-11 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-ink shadow-card"
          >
            Done
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setExploring(true)}
          aria-label="Explore 3D tour"
          className="relative block h-full w-full bg-surface-soft"
        >
          <TourTileFace photo={photo} />
        </button>
      )}
    </div>
  );
}

export default function PropertyGallery({
  media,
  tourUrl,
  viewerActions,
  children,
}: {
  media: GalleryPhoto[];
  /** The unbranded virtual tour URL. The "3D tour" entry shows only when it passes `resolveTourEntry`. */
  tourUrl?: string | null;
  /** Buttons for the full-screen viewer's top bar, for example Share and Save. */
  viewerActions?: ReactNode;
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
    'pointer-events-auto inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-ink shadow-card md:min-h-0 md:text-sm';
  /** On a phone the strip plays the tour in place. Elsewhere the viewer opens on the tour slide. */
  const showTour = () => {
    const track = trackRef.current;
    const phone =
      typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 768px)').matches;
    if (phone && track) {
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
  const openTourViewer = () => {
    setActiveIdx(tourSlide);
    setOpen(true);
  };
  const pill = !entry ? null : tour ? (
    <button
      type="button"
      onClick={showTour}
      aria-label="Open 3D tour"
      data-testid="gallery-tour-pill"
      className={tourPill}
    >
      <TourIcon className="h-4 w-4" />
      3D
    </button>
  ) : (
    <a
      href={entry.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open 3D tour in a new tab"
      data-testid="gallery-tour-pill"
      className={tourPill}
    >
      <TourIcon className="h-4 w-4" />
      3D
      <ExternalIcon className="h-3.5 w-3.5" />
    </a>
  );
  const tileClass = 'relative overflow-hidden bg-surface-soft transition hover:brightness-95';
  const tourTile = !entry ? null : tour ? (
    <button
      type="button"
      onClick={openTourViewer}
      aria-label="Open 3D tour"
      data-testid="gallery-tour-tile"
      className={tileClass}
    >
      <TourTileFace photo={media[1 % Math.max(media.length, 1)] ?? null} />
    </button>
  ) : (
    <a
      href={entry.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open 3D tour in a new tab"
      data-testid="gallery-tour-tile"
      className={tileClass}
    >
      <TourTileFace photo={media[1 % Math.max(media.length, 1)] ?? null} external />
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
      actions={viewerActions}
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
        {pill && (
          <div className="absolute bottom-3 right-3 z-10 md:bottom-4 md:right-4">{pill}</div>
        )}
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
                <StripTourSlide
                  key="tour"
                  tour={tour}
                  photo={media[1 % media.length]}
                  inView={swipeIdx === tourSlide}
                />
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
          {/* The bottom-right row. The bottom left stays clear for the Bright MLS watermark. */}
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-2">
            {swipeIdx !== tourSlide && pill}
            <span
              data-testid="gallery-swipe-counter"
              className="pointer-events-none rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold tabular-nums text-ink shadow-card"
            >
              {Math.min(swipeIdx, slideCount - 1) + 1} / {slideCount}
            </span>
          </div>
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
          {tourTile}
          {tileIndices.slice(tourTile ? 2 : 1).map((mediaIdx, tileIdx) => (
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
      </div>
      {viewer}
    </>
  );
}
