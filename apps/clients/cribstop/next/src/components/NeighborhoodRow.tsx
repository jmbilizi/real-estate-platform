'use client';

import Link from 'next/link';
import {
  CAROUSEL_ITEM_CLASS,
  CAROUSEL_SCROLLER_CLASS,
  CarouselArrows,
  useCarouselScroll,
} from '@/components/CarouselShell';
import NeighborhoodCard, {
  type Neighborhood,
  NeighborhoodCardSkeleton,
  SeeAllCard,
  seeAllPhotos,
} from '@/components/NeighborhoodCard';

export type { Neighborhood };

/** The container, not the card, sets the card width in the carousel (#534). */
const ROW_ITEM_CLASS = `${CAROUSEL_ITEM_CLASS} min-w-0 flex`;

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
  const visible = neighborhoods.slice(0, max);
  const { scrollerRef, atStart, atEnd, scroll } = useCarouselScroll([loading, visible.length]);

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
          <CarouselArrows atStart={atStart} atEnd={atEnd} onScroll={scroll} />
        </div>
        {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      </div>
      <div ref={scrollerRef} className={CAROUSEL_SCROLLER_CLASS}>
        {loading ? (
          // With `href`, one more skeleton stands in for the "See all" tile.
          Array.from({ length: href ? max + 1 : max }, (_, i) => (
            <div key={i} className={ROW_ITEM_CLASS}>
              <NeighborhoodCardSkeleton />
            </div>
          ))
        ) : (
          <>
            {visible.map((n) => (
              <div key={`${n.name}-${n.city}-${n.state}`} className={ROW_ITEM_CLASS}>
                <NeighborhoodCard n={n} />
              </div>
            ))}
            {href && (
              <div className={ROW_ITEM_CLASS}>
                <SeeAllCard href={href} photos={seeAllPhotos(visible)} title={title} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
