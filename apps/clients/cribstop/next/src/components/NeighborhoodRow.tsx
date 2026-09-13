'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Neighborhood {
  name: string;
  city: string;
  img: string;
}

/**
 * The same fill every other placeholder in the app is painted with — see the `FILL` constant in
 * `listing/ListingStates.tsx`, which documents why the colour and the animation travel together.
 * Imported by value rather than re-derived so this row cannot drift into a loading look of its own.
 */
const FILL = 'bg-surface-soft skeleton-fill';

/**
 * Whether a photo has finished loading (or failed trying).
 *
 * `complete` is checked on mount as well as via the handlers, because a cached photo can finish
 * decoding before React attaches them — that tile would otherwise stay in its loading state
 * forever. The failure path settles too: a dead URL has to stop the sweep, or it animates for the
 * life of the page, which for eight hardcoded remote photos is a realistic way for this to rot.
 */
function useImageSettled(ref: React.RefObject<HTMLImageElement | null>) {
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    if (ref.current?.complete) setSettled(true);
  }, [ref]);

  const settle = () => setSettled(true);
  return { settled, onLoad: settle, onError: settle };
}

/**
 * One neighbourhood tile, and the placeholder it shows until its photo lands.
 *
 * These tiles are not data-loading — the list is a static constant — so what is missing on first
 * paint is the *photo*, a remote fetch. Two things about that make the tile a special case rather
 * than "a listing card with an image":
 *
 * **The caption lives on the photo, not under it.** It is white type over a `from-black/80`
 * gradient, so with no picture behind it the tile is white text on white. Anything painted in that
 * box during load is also *under* that gradient, which crushes `--skeleton-tint` to nothing in the
 * lower half — a placeholder there does not read as the same sweep as the carousels beside it even
 * though it is literally the same class.
 *
 * **So the whole tile is the placeholder, not just the image area.** Skeletoning the photo while
 * leaving the real caption and gradient drawn on top of it is the "half-alive card" failure
 * `ListingCardSkeleton` documents: half-real and half-grey reads as a broken render rather than as
 * a tile arriving. The same call was made deliberately on the detail panel, which stays uniformly
 * skeletal even though a card click already has the address and price in hand.
 *
 * A single block is the faithful shape here — the tile *is* a photo, with nothing beside it — which
 * is what the gallery tile placeholders in `ListingStates` are too. The photo stays mounted
 * underneath at `opacity-0` so it actually loads, then fades in with `content-resolved` rather than
 * snapping.
 */
function NeighborhoodTile({ n }: { n: Neighborhood }) {
  const ref = useRef<HTMLImageElement>(null);
  const { settled, onLoad, onError } = useImageSettled(ref);

  return (
    <Link
      href={`/search?neighborhood=${encodeURIComponent(n.name)}`}
      className="group relative flex-shrink-0 snap-start aspect-[4/5] overflow-hidden rounded-md w-[calc((100%-1.25rem)/2)] sm:w-[calc((100%-2.5rem)/3)] md:w-[calc((100%-3.75rem)/4)] lg:w-[calc((100%-5rem)/5)] xl:w-[calc((100%-6.25rem)/6)] min-w-0"
      // The tile is a placeholder until the photo lands: it names a real destination, but there is
      // nothing on it yet to say which one, so it is not a link anything should land on.
      aria-hidden={settled ? undefined : true}
      tabIndex={settled ? undefined : -1}
    >
      {}
      <img
        ref={ref}
        src={n.img}
        alt={n.name}
        onLoad={onLoad}
        onError={onError}
        className={`absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110 ${
          settled ? 'content-resolved' : 'opacity-0'
        }`}
      />
      {!settled && <span aria-hidden="true" className={`absolute inset-0 ${FILL}`} />}
      {settled && (
        <div className="content-resolved">
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 text-white">
            <h3 className="font-display text-xl font-bold">{n.name}</h3>
            <p className="mt-0.5 text-sm text-white/85">{n.city}</p>
            {/*
             * No inventory count. These tiles used to render a hardcoded `count` as "24 homes",
             * which was a fabricated fact (PRD §6.3) — and once the carousels beside it started
             * coming from the real API, it was also verifiably wrong. A true per-neighbourhood
             * count would need a search request per tile, which is not worth six more gateway
             * calls on the busiest page, so the affordance states what it does instead of
             * asserting a number.
             */}
            <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-white/95">
              Browse homes
              <span aria-hidden>→</span>
            </p>
          </div>
        </div>
      )}
    </Link>
  );
}

/** A stacked thumbnail on the "See all" tile. No caption over it, so the block is the whole story. */
function StackedThumb({ src }: { src: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const { settled, onLoad, onError } = useImageSettled(ref);

  return (
    <>
      {!settled && <span aria-hidden="true" className={`absolute inset-0 ${FILL}`} />}
      {}
      <img
        ref={ref}
        src={src}
        alt=""
        onLoad={onLoad}
        onError={onError}
        className={`h-full w-full object-cover ${settled ? 'content-resolved' : 'opacity-0'}`}
      />
    </>
  );
}

interface Props {
  title: string;
  subtitle?: string;
  href?: string;
  neighborhoods: Neighborhood[];
  max?: number;
}

export default function NeighborhoodRow({ title, subtitle, href, neighborhoods, max = 4 }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Show See all card only if neighborhoods.length > max
  const showSeeAll = neighborhoods.length > max;
  const visible = showSeeAll ? neighborhoods.slice(0, max) : neighborhoods;

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const checkScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, []);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
    setTimeout(checkScroll, 350);
  };

  return (
    <section className="px-6 pt-6 sm:px-10 lg:px-20">
      <div className="flex flex-col gap-1 pb-1">
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
            {href && (
              <Link
                href={href}
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full border border-surface-border bg-white text-ink transition hover:bg-surface-alt hover:shadow-card"
                aria-label="See all"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => scroll('left')}
              aria-label="Scroll left"
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-surface-border bg-white text-ink transition hover:shadow-card ${atStart ? 'opacity-50 cursor-default' : 'hover:bg-surface-alt'}`}
              disabled={atStart}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              aria-label="Scroll right"
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-surface-border bg-white text-ink transition hover:shadow-card ${atEnd ? 'opacity-50 cursor-default' : 'hover:bg-surface-alt'}`}
              disabled={atEnd}
            >
              <svg
                className="h-4 w-4"
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
        {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      </div>
      <div
        ref={scrollerRef}
        className="mt-4 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 scrollbar-none"
      >
        {visible.map((n) => (
          <NeighborhoodTile key={n.name} n={n} />
        ))}
        {showSeeAll && (
          <Link
            key="see-all"
            href={href!}
            className="group flex flex-shrink-0 snap-start flex-col items-center justify-center gap-3 rounded-md border border-surface-border bg-surface-alt/40 p-6 text-center transition hover:bg-surface-alt hover:shadow-card [scroll-snap-stop:always] aspect-[4/5] w-[calc((100%-1.25rem)/2)] sm:w-[calc((100%-2.5rem)/3)] md:w-[calc((100%-3.75rem)/4)] lg:w-[calc((100%-5rem)/5)] xl:w-[calc((100%-6.25rem)/6)] min-w-0"
          >
            <div className="relative aspect-square w-[80px] mx-auto rounded-md overflow-visible flex items-center justify-center">
              {/* Airbnb-style stacked preview: 3 images, visually overlapped, center stack */}
              {[0, 1, 2].map((offset) => {
                const card = visible[offset] || neighborhoods[offset];
                const img = card?.img || '';
                const base = 32;
                const positions = [
                  { z: 1, x: -base, y: 8, rot: -8 },
                  { z: 2, x: 0, y: 0, rot: 0 },
                  { z: 3, x: base, y: 8, rot: 8 },
                ];
                const pos = positions[offset];
                return (
                  <span
                    key={offset}
                    className="absolute rounded-md border-2 border-white shadow-card bg-white overflow-hidden"
                    style={{
                      left: '50%',
                      top: '50%',
                      width: '56px',
                      height: '56px',
                      zIndex: pos.z,
                      transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotate(${pos.rot}deg)`,
                    }}
                  >
                    {img && <StackedThumb src={img} />}
                  </span>
                );
              })}
            </div>
            <div>
              <p className="font-display text-base font-bold text-ink group-hover:underline">
                See all
              </p>
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
