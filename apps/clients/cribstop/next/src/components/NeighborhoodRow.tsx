'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { type NeighborhoodPreviewPhoto, searchPath } from '@cribstop/property-contracts';
import NeighborhoodPhotoStack, { PHOTO_AREA_CLASS } from '@/components/NeighborhoodPhotoStack';
import { searchTargetUrl } from '@/lib/search-place';

/** One "Explore neighborhoods" tile (#393): name, place and counts, sourced from real data. */
export interface Neighborhood {
  name: string;
  city: string;
  state: string;
  /** Matching for-sale count. */
  sale: number;
  /** Matching for-rent count. */
  rent: number;
  /** Live listing photos from the tile's own search results (#486), 0 to 5. */
  previewPhotos?: NeighborhoodPreviewPhoto[];
}

/** The shared per-tile width breakpoints, for real tiles and their loading skeletons alike. */
const TILE_WIDTH_CLASS =
  'w-[calc((100%-1.25rem)/2)] sm:w-[calc((100%-2.5rem)/3)] md:w-[calc((100%-3.75rem)/4)] lg:w-[calc((100%-5rem)/5)] xl:w-[calc((100%-6.25rem)/6)] min-w-0';

/** In a grid (#493) the cell sets the width, so the tile fills it. */
const GRID_TILE_CLASS = 'w-full min-w-0';
const ROW_TILE_CLASS = `flex-shrink-0 snap-start ${TILE_WIDTH_CLASS}`;

const COUNT_LINK_CLASS =
  'flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded px-0 text-center text-[11px] font-semibold sm:text-xs leading-tight text-ink-muted hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';

/**
 * Tile (#492). The main link is the name, stretched over the whole tile by a pseudo-element. The
 * count links are siblings above it (`z-10`), never nested inside it. Each count link is
 * `min-h-11` and takes its own half of the row, so the two hit areas never overlap.
 */
export function NeighborhoodTile({
  n,
  grid = false,
  href: hrefOverride,
  onSelect,
}: {
  n: Neighborhood;
  grid?: boolean;
  /** Replaces the name link's target (#502). The count links keep their own targets. */
  href?: string;
  /** Runs on a plain click of the name link, in place of the navigation (#502). */
  onSelect?: () => void;
}) {
  const place = { kind: 'neighborhood', name: n.name, city: n.city, state: n.state } as const;
  const href = hrefOverride ?? searchTargetUrl({ kind: 'place', place }, 'all');

  return (
    <div
      className={`group relative flex flex-col items-center rounded-md border border-surface-border bg-white px-2 py-3 sm:px-3 text-center transition hover:shadow-card ${grid ? GRID_TILE_CLASS : ROW_TILE_CLASS}`}
    >
      <NeighborhoodPhotoStack photos={n.previewPhotos ?? []} />
      <h3 className="w-full truncate font-display text-base font-bold leading-6 text-ink">
        <Link
          href={href}
          onClick={
            onSelect
              ? (e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onSelect();
                }
              : undefined
          }
          className="after:absolute after:inset-0 after:rounded-md after:content-[''] group-hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink"
        >
          {n.name}
        </Link>
      </h3>
      <p className="w-full truncate text-sm leading-5 text-ink-muted">
        {n.city}, {n.state}
      </p>
      {/* A zero count renders nothing. The row's request needs at least one matching listing
       *  (`minCount`), so a tile never has two zero counts. */}
      <div className="relative z-10 mt-1 flex w-full">
        {n.sale > 0 && (
          <Link
            href={searchPath(place, 'homes-for-sale')}
            aria-label={`${n.sale.toLocaleString()} for sale in ${n.name}`}
            className={COUNT_LINK_CLASS}
          >
            {n.sale.toLocaleString()} for sale
          </Link>
        )}
        {n.rent > 0 && (
          <Link
            href={searchPath(place, 'homes-for-rent')}
            aria-label={`${n.rent.toLocaleString()} for rent in ${n.name}`}
            className={COUNT_LINK_CLASS}
          >
            {n.rent.toLocaleString()} for rent
          </Link>
        )}
      </div>
    </div>
  );
}

/** Most photos the "See all" tile may draw from. The stack shows 3, the rest replace failed loads. */
const SEE_ALL_PHOTO_POOL = 5;

/**
 * Photos for the "See all" tile (#495): one per tile first, then the extras. Every photo comes
 * from a tile already in the row, so each is a listing in a target the row links to.
 */
export function seeAllPhotos(neighborhoods: Neighborhood[]): NeighborhoodPreviewPhoto[] {
  const lists = neighborhoods.map((n) => n.previewPhotos ?? []);
  const ordered = [...lists.map((l) => l[0]), ...lists.flatMap((l) => l.slice(1))];
  const seen = new Set<string>();
  const photos: NeighborhoodPreviewPhoto[] = [];
  for (const photo of ordered) {
    if (!photo || seen.has(photo.url)) continue;
    seen.add(photo.url);
    photos.push(photo);
    if (photos.length === SEE_ALL_PHOTO_POOL) break;
  }
  return photos;
}

/**
 * Trailing tile (#495). Same box and width as `NeighborhoodTile`. The whole tile is one link. With
 * no photo the stack shows its placeholder.
 */
export function SeeAllTile({
  href,
  photos,
  title,
}: {
  href: string;
  photos: NeighborhoodPreviewPhoto[];
  title: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${title} — see all`}
      data-testid="neighborhood-see-all-tile"
      className={`group flex min-h-11 flex-col items-center rounded-md border border-surface-border bg-surface-alt/40 px-2 py-3 sm:px-3 text-center transition hover:bg-surface-alt hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink [scroll-snap-stop:always] ${ROW_TILE_CLASS}`}
    >
      <NeighborhoodPhotoStack photos={photos} />
      <span className="w-full truncate font-display text-base font-bold leading-6 text-ink group-hover:underline">
        See all
      </span>
    </Link>
  );
}

/** Same box structure as `NeighborhoodTile`, so the row never shifts height once data lands. */
export function NeighborhoodTileSkeleton({ grid = false }: { grid?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col items-center rounded-md border border-surface-border bg-white px-2 py-3 sm:px-3 ${grid ? GRID_TILE_CLASS : ROW_TILE_CLASS}`}
    >
      <div className={`${PHOTO_AREA_CLASS} rounded bg-surface-soft skeleton-fill`} />
      <div className="flex h-6 w-full items-center justify-center">
        <div className="h-4 w-3/4 rounded bg-surface-soft skeleton-fill" />
      </div>
      <div className="flex h-5 w-full items-center justify-center">
        <div className="h-3 w-1/2 rounded bg-surface-soft skeleton-fill" />
      </div>
      <div className="mt-1 flex min-h-11 w-full items-center justify-center">
        <div className="h-3 w-2/3 rounded bg-surface-soft skeleton-fill" />
      </div>
    </div>
  );
}

interface Props {
  title: string;
  subtitle?: string;
  /** Present only when the row supports a "See all" link. Adds the header chip and, after the last
   *  tile, a "See all" tile (#495). */
  href?: string;
  neighborhoods: Neighborhood[];
  /** Renders this many skeleton tiles instead of `neighborhoods`. */
  loading?: boolean;
  /** Up to this many neighborhood tiles render. With `href`, a "See all" tile follows the last one. */
  max?: number;
}

export default function NeighborhoodRow({
  title,
  subtitle,
  href,
  neighborhoods,
  loading = false,
  max = 8,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const visible = neighborhoods.slice(0, max);

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
  }, [loading, visible.length]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
    setTimeout(checkScroll, 350);
  };

  if (!loading && visible.length === 0) return null;

  return (
    <section className="px-6 pt-6 sm:px-10 lg:px-20">
      {/* `gap-1.5`, not `gap-1` (#447): the title/chip link's `before:-bottom-1.5` hit area reaches
          6px below its own box, so a smaller gap here would let that invisible hit area cover the
          top of `subtitle`'s text. */}
      <div className="flex flex-col gap-1.5 pb-1">
        <div className="flex items-center gap-2 justify-between">
          {/* Title and chip are one link (#423): the visible chip is ~32px. The tap target still
              reaches 44px (#447), via the `before:` pseudo element below rather than `min-h-11` —
              a layout-height floor left dead space under the title, blowing out the gap to the
              carousel. The pseudo element extends the hit area 6px past each edge without adding
              box height, since an absolutely-positioned pseudo never contributes to its parent's
              layout size. */}
          {href ? (
            <Link
              href={href}
              // `aria-label` replaces a link's whole accessible name (its own text content
              // included), so it must repeat the title — otherwise a screen reader announces only
              // "See all" and drops which row it is.
              aria-label={`${title} — see all`}
              // `min-w-0`: this link's title can genuinely be long ("Explore neighborhoods across
              // the region") and needs `line-clamp-2` to work, which needs a flex ancestor allowed
              // to shrink past its content width.
              // Below `sm` (#429): `flex w-full justify-between` spreads title and chip across the
              // row instead of pairing them; from `sm` up, back to the original inline pairing
              // beside the title. `items-start`, not `items-center` (#432): the title now wraps to
              // 2 lines rather than truncating, so centering on the whole block would float the
              // chip below the first line.
              className="group relative flex min-h-8 min-w-0 w-full items-start justify-between gap-1.5 before:absolute before:-top-1.5 before:-bottom-1.5 before:inset-x-0 before:content-[''] sm:inline-flex sm:w-auto sm:justify-normal"
            >
              <h2 className="min-w-0 line-clamp-2 font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]">
                {title}
              </h2>
              {/* `relative top-0.5` centers the chip on the first line's height rather than the
                  container's top edge, now that the title can run to a second line (#432) — a
                  relative offset shifts the paint only, not the layout box, so it cannot add to
                  the header's own height the way a `margin-top` did and blow out the gap to the
                  carousel below (#447). */}
              <span className="relative top-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-soft text-ink transition group-hover:bg-surface-border">
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  {/* Straight arrow (shaft + head), not a chevron (#429) — Airbnb's "see all". */}
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </Link>
          ) : (
            <h2 className="truncate font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]">
              {title}
            </h2>
          )}
          {/* The visible circle is 32px. Each button's tap target stays 44px through the same
              `before:` hit-area technique as the title link above (#447), not a `h-11` box. A
              `h-11` box would make this row 44px tall next to the title's 32px.
              `gap-3`, not `gap-2`: each button's `before:-inset-1.5` hit area reaches 6px past its
              own visible edge. Anything less than 12px between the two circles lets their hit
              areas overlap. */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => scroll('left')}
              aria-label="Scroll left"
              disabled={atStart}
              className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center before:absolute before:-inset-1.5 before:content-[''] ${atStart ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border border-surface-border bg-white text-ink transition ${atStart ? '' : 'hover:bg-surface-alt'}`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              aria-label="Scroll right"
              disabled={atEnd}
              className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center before:absolute before:-inset-1.5 before:content-[''] ${atEnd ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border border-surface-border bg-white text-ink transition ${atEnd ? '' : 'hover:bg-surface-alt'}`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </div>
        </div>
        {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      </div>
      <div
        ref={scrollerRef}
        // `mt-3` at every breakpoint (#447): with the header's layout height now equal to its
        // content (see the `before:` hit-area comment above), this margin is the whole gap to the
        // tiles, landing at ~16-20px measured from the title's own text bottom.
        className="mt-3 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3 scrollbar-none"
      >
        {loading ? (
          // With `href`, one more skeleton stands in for the "See all" tile.
          Array.from({ length: href ? max + 1 : max }, (_, i) => (
            <NeighborhoodTileSkeleton key={i} />
          ))
        ) : (
          <>
            {visible.map((n) => (
              <NeighborhoodTile key={`${n.name}-${n.city}-${n.state}`} n={n} />
            ))}
            {href && <SeeAllTile href={href} photos={seeAllPhotos(visible)} title={title} />}
          </>
        )}
      </div>
    </section>
  );
}
