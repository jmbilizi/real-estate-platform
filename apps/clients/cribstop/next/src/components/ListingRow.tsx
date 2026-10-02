'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import ListingCard from './ListingCard';
import { CARD_HOVER_CLASS } from '@/components/cardHover';
import {
  CAROUSEL_ITEM_CLASS,
  CAROUSEL_SCROLLER_CLASS,
  CarouselArrows,
  useCarouselScroll,
} from '@/components/CarouselShell';
import { CARD_WIDTH_CLASS, ListingCardSkeleton } from '@/components/listing/ListingStates';
import { EmptyStateCard } from '@/components/EmptyState';
import type { ListingCardRow } from '@/lib/types';

interface Props {
  title: string;
  subtitle?: string;
  href?: string;
  listings: ListingCardRow[];
  /** Max number of listing cards to render before the "See all" tile. Defaults to 4. */
  max?: number;
  /** Override the section's outer padding class. Defaults to "px-6 pt-6 sm:px-10 lg:px-20" */
  sectionClassName?: string;
  /**
   * Override the heading's type classes. Defaults to the page-level section size (20/24px).
   *
   * A row nested inside a panel is not a page-level section: on the listing detail page the row's
   * 24px heading outranked that page's own 20px section headings ("About this home", "Where you'll
   * live"), so the same rank rendered at two sizes depending on which component drew it.
   */
  titleClassName?: string;
  /** Renders `max` skeleton cards in the carousel shape instead of `listings`. */
  loading?: boolean;
  /** Shows retry card when the fetch failed. */
  failed?: boolean;
  /** Callback for retry action when failed. */
  onRetry?: () => void;
  /** Control between the title and the see-all chip, on the title's first line (#484). */
  headerExtra?: ReactNode;
}

/** The carousel's per-card width breakpoints, shared by real cards and their loading skeletons. */

export default function ListingRow({
  title,
  subtitle,
  href,
  listings,
  max = 4,
  sectionClassName,
  titleClassName,
  loading = false,
  failed = false,
  onRetry,
  headerExtra,
}: Props) {
  // Show max+1 cards so See all is always after scroll
  const showSeeAll = !loading && listings.length > max;
  const visible = showSeeAll ? listings.slice(0, max + 1) : listings;
  const { scrollerRef, atStart, atEnd, scroll } = useCarouselScroll([loading, visible.length]);

  return (
    <section className={sectionClassName ?? 'px-6 pt-6 sm:px-10 lg:px-20'}>
      {/* `gap-1.5`, not `gap-1` (#447): the title/chip link's `before:-bottom-1.5` hit area reaches
          6px below its own box, so a smaller gap here would let that invisible hit area cover the
          top of `subtitle`'s text. */}
      <div className="flex flex-col gap-1.5 pb-1">
        <div className="flex items-center gap-2 justify-between">
          {/* Hidden while failed: "See all" links into a search page backed by the request that
              just failed, and the scroll arrows would be framing a single retry card. Title and
              chip are one link (#423) — the visual chip is ~32px. The tap target still reaches
              44px (#447), but via the `before:` pseudo element below rather than `min-h-11`: a
              layout-height floor left ~16px of dead space under a 28px title, blowing out the gap
              to the carousel below. The pseudo element extends the hit area 6px past each edge
              (32px + 6 + 6 = 44px) without adding box height, since an absolutely-positioned
              pseudo never contributes to its parent's layout size. */}
          {headerExtra ? (
            /* #484. Title, then the control, then the chip. The chip is its own link here, so the
               control can sit between them. Below `sm` the chip moves to the far right, as on every
               other row. The title wraps to 2 lines rather than truncating (#432). The control and
               chip stay centered on its first line (the `h-7` boxes match the title line height). */
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {href && !failed ? (
                <Link
                  href={href}
                  aria-label={`${title} — see all`}
                  prefetch
                  className="relative min-w-0 before:absolute before:-top-1.5 before:-bottom-1.5 before:inset-x-0 before:content-['']"
                >
                  <h2
                    className={
                      titleClassName ??
                      'line-clamp-2 font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]'
                    }
                  >
                    {title}
                  </h2>
                </Link>
              ) : (
                <h2
                  className={
                    titleClassName ??
                    'line-clamp-2 min-w-0 font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]'
                  }
                >
                  {title}
                </h2>
              )}
              <div className="flex h-7 shrink-0 items-center">{headerExtra}</div>
              {href && !failed && (
                // A duplicate of the title link for pointer users only: the title link above
                // already carries the accessible "see all" name and the tab stop.
                <Link
                  href={href}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="group relative ml-auto flex h-7 w-11 shrink-0 items-center justify-center before:absolute before:-top-2 before:-bottom-2 before:inset-x-0 before:content-[''] sm:ml-0"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-soft text-ink transition group-hover:bg-surface-border">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14M12 5l7 7-7 7"
                      />
                    </svg>
                  </span>
                </Link>
              )}
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
              {href && !failed ? (
                <Link
                  href={href}
                  // `aria-label` replaces a link's whole accessible name (its own text content
                  // included), so it must repeat the title — otherwise a screen reader announces only
                  // "See all" and drops which row it is.
                  aria-label={`${title} — see all`}
                  prefetch
                  // Below `sm` (#429): the chip sits at the far right of the header row, not right
                  // beside the title — `flex w-full justify-between` spreads title and chip across
                  // the row. From `sm` up: back to the original inline pairing beside the title.
                  // `items-start`, not `items-center` (#432): a title now wraps to 2 lines rather than
                  // truncating (every title must keep its "for sale"/"rentals" word), and centering on
                  // the whole 2-line block would float the chip below the first line.
                  className="group relative flex min-h-8 min-w-11 w-full items-start justify-between gap-1.5 before:absolute before:-top-1.5 before:-bottom-1.5 before:inset-x-0 before:content-[''] sm:inline-flex sm:w-auto sm:justify-normal"
                >
                  <h2
                    className={
                      titleClassName ??
                      'min-w-0 line-clamp-2 font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]'
                    }
                  >
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
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 12h14M12 5l7 7-7 7"
                      />
                    </svg>
                  </span>
                </Link>
              ) : (
                <h2
                  className={
                    titleClassName ??
                    'font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]'
                  }
                >
                  {title}
                </h2>
              )}
            </div>
          )}
          <CarouselArrows atStart={atStart} atEnd={atEnd} onScroll={scroll} hidden={failed} />
        </div>
        {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      </div>

      <div ref={scrollerRef} className={CAROUSEL_SCROLLER_CLASS}>
        {loading &&
          Array.from({ length: max }, (_, i) => (
            <div key={i} className={CARD_WIDTH_CLASS}>
              <ListingCardSkeleton />
            </div>
          ))}
        {!loading &&
          !failed &&
          visible.map((l, i) => {
            // If this is the last card and See all should be shown, render See all tile
            if (showSeeAll && i === max) {
              return (
                <Link
                  key="see-all"
                  href={href!}
                  className={`group flex flex-col items-center justify-center gap-3 rounded-md border border-surface-border bg-surface-alt/40 p-6 text-center ${CARD_HOVER_CLASS} ${CAROUSEL_ITEM_CLASS}`}
                  prefetch
                >
                  <div className="relative aspect-square w-[80px] mx-auto rounded-md overflow-visible flex items-center justify-center">
                    {/* Airbnb-style stacked preview: 3 images, visually overlapped, center stack */}
                    {[0, 1, 2].map((offset) => {
                      const card = visible[offset] || listings[offset];
                      const img = card?.primaryMedia?.url || '';
                      // Center the middle card, overlap left/right
                      const base = 32; // px size for overlap
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
                          {}
                          {img && (
                            <img
                              src={img}
                              alt=""
                              className="h-full w-full bg-surface-soft object-contain"
                            />
                          )}
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
              );
            }
            // Otherwise, render a normal listing card
            return (
              <div key={l.id} className={CARD_WIDTH_CLASS}>
                <ListingCard listing={l} />
              </div>
            );
          })}
        {failed && (
          <div className={CARD_WIDTH_CLASS}>
            <EmptyStateCard variant="failed" onRetry={onRetry} />
          </div>
        )}
      </div>
    </section>
  );
}
