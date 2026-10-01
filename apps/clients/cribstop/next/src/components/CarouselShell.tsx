'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Chrome shared by `ListingRow` and `NeighborhoodRow` (#508). Both rows take their scroller,
 * item width and arrows from here, so the two carousels cannot drift apart.
 */

/** Item width per breakpoint. Below `sm` an item is 42% wide so the next one peeks. */
export const CAROUSEL_ITEM_WIDTH_CLASS =
  'w-[42%] sm:w-[calc((100%-2.5rem)/3)] md:w-[calc((100%-3.75rem)/4)] lg:w-[calc((100%-5rem)/5)] xl:w-[calc((100%-6.25rem)/6)] 2xl:w-[calc((100%-7.5rem)/7)]';

/** A scroll-snapping row item: the width above plus the snap behavior. */
export const CAROUSEL_ITEM_CLASS = `flex-shrink-0 snap-start [scroll-snap-stop:always] ${CAROUSEL_ITEM_WIDTH_CLASS}`;

/**
 * `-mr-6 sm:mr-0`: the right edge bleeds past the section's padding below `sm`. The cut-off next
 * item is the "peek", not a rendering bug. `mt-3` is the whole gap to the header (#447).
 */
export const CAROUSEL_SCROLLER_CLASS =
  'mt-3 flex snap-x snap-mandatory gap-3 sm:gap-5 overflow-x-auto pb-3 scrollbar-none -mr-6 sm:mr-0';

/** Scroll position state and the arrow handler for one scroller. */
export function useCarouselScroll(rescanKey: readonly unknown[]) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const checkScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  };

  // Re-checks when the content changes, not only on mount. The loading skeleton can fit the
  // viewport and latch `atEnd`, and wider real content then never re-measures (#292).
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
  }, rescanKey);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.85;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
    setTimeout(checkScroll, 350);
  };

  return { scrollerRef, atStart, atEnd, scroll };
}

/**
 * Arrow buttons. Touch is the control below `sm`, so the arrows show from `sm` up. Each circle
 * is 32px and its tap target is 44px through a `before:` hit area (#447). `gap-3` keeps the two
 * hit areas from overlapping.
 */
export function CarouselArrows({
  atStart,
  atEnd,
  onScroll,
  hidden = false,
}: {
  atStart: boolean;
  atEnd: boolean;
  onScroll: (dir: 'left' | 'right') => void;
  /** Hides the arrows at every width, for a failed row. */
  hidden?: boolean;
}) {
  const button = (dir: 'left' | 'right', disabled: boolean, path: string) => (
    <button
      type="button"
      onClick={() => onScroll(dir)}
      aria-label={`Scroll ${dir}`}
      disabled={disabled}
      className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center before:absolute before:-inset-1.5 before:content-[''] ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full border border-surface-border bg-white text-ink transition ${disabled ? '' : 'hover:bg-surface-alt'}`}
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={path} />
        </svg>
      </span>
    </button>
  );
  return (
    <div className={`items-center gap-3 ${hidden ? 'hidden' : 'hidden sm:flex'}`}>
      {button('left', atStart, 'M15 19l-7-7 7-7')}
      {button('right', atEnd, 'M9 5l7 7-7 7')}
    </div>
  );
}
