'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { searchPath } from '@cribstop/property-contracts';

/** One "Explore neighborhoods" tile (#393): name, place and counts, sourced from real data. */
export interface Neighborhood {
  name: string;
  city: string;
  state: string;
  /** Matching for-sale count. */
  sale: number;
  /** Matching for-rent count. */
  rent: number;
}

/** The shared per-tile width breakpoints, for real tiles and their loading skeletons alike. */
const TILE_WIDTH_CLASS =
  'w-[calc((100%-1.25rem)/2)] sm:w-[calc((100%-2.5rem)/3)] md:w-[calc((100%-3.75rem)/4)] lg:w-[calc((100%-5rem)/5)] xl:w-[calc((100%-6.25rem)/6)] min-w-0';

/** "{sale} for sale · {rent} for rent" — a zero part is omitted (never a fabricated count). */
function countsText(n: Neighborhood): string {
  const parts: string[] = [];
  if (n.sale > 0) parts.push(`${n.sale.toLocaleString()} for sale`);
  if (n.rent > 0) parts.push(`${n.rent.toLocaleString()} for rent`);
  return parts.join(' · ');
}

function NeighborhoodTile({ n }: { n: Neighborhood }) {
  const href = searchPath(
    { kind: 'neighborhood', name: n.name, city: n.city, state: n.state },
    'homes-for-sale',
  );
  const counts = countsText(n);

  return (
    <Link
      href={href}
      className={`group flex-shrink-0 snap-start rounded-md border border-surface-border bg-white p-4 transition hover:shadow-card ${TILE_WIDTH_CLASS}`}
    >
      <h3 className="truncate font-display text-base font-bold text-ink group-hover:underline">
        {n.name}
      </h3>
      <p className="mt-0.5 truncate text-sm text-ink-muted">
        {n.city}, {n.state}
      </p>
      {/* Guaranteed non-empty: the row's own request requires at least one matching listing
       *  (`minCount`), so `n.sale` and `n.rent` are never both zero. */}
      <p className="mt-2 text-xs font-semibold text-ink-muted">{counts}</p>
    </Link>
  );
}

/** Same shape as `NeighborhoodTile`, so the row never shifts height once real data lands. */
function NeighborhoodTileSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`flex-shrink-0 snap-start rounded-md border border-surface-border bg-white p-4 ${TILE_WIDTH_CLASS}`}
    >
      <div className="h-4 w-3/4 rounded bg-surface-soft skeleton-fill" />
      <div className="mt-2 h-3 w-1/2 rounded bg-surface-soft skeleton-fill" />
      <div className="mt-3 h-3 w-2/3 rounded bg-surface-soft skeleton-fill" />
    </div>
  );
}

interface Props {
  title: string;
  subtitle?: string;
  /** Present only when the row supports a "See all" link. Omitted here (#393): every tile scrolls
   *  into view, with no separate results page to see all from. */
  href?: string;
  neighborhoods: Neighborhood[];
  /** Renders this many skeleton tiles instead of `neighborhoods`. */
  loading?: boolean;
  /** Up to this many tiles render, all visible via horizontal scroll rather than a "See all" tile. */
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
        {loading
          ? Array.from({ length: max }, (_, i) => <NeighborhoodTileSkeleton key={i} />)
          : visible.map((n) => <NeighborhoodTile key={`${n.name}-${n.city}-${n.state}`} n={n} />)}
      </div>
    </section>
  );
}
