'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ListingCard from './ListingCard';
import type { Listing } from '@/lib/types';

interface Props {
  title: string;
  subtitle?: string;
  href?: string;
  listings: Listing[];
  /** Max number of listing cards to render before the "See all" tile. Defaults to 4. */
  max?: number;
}

export default function ListingRow({ title, subtitle, href, listings, max = 4 }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Show max+1 cards so See all is always after scroll
  const showSeeAll = listings.length > max;
  const visible = showSeeAll ? listings.slice(0, max + 1) : listings;

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Check scroll position to enable/disable buttons
  const checkScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2); // allow for rounding
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
    // Wait for scroll to finish, then check
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
                prefetch
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
          <div className="hidden items-center gap-2 sm:flex">
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
        {visible.map((l, i) => {
          // If this is the last card and See all should be shown, render See all tile
          if (showSeeAll && i === max) {
            return (
              <Link
                key="see-all"
                href={href!}
                className="group flex w-[calc((100%-1.25rem)/2)] flex-shrink-0 snap-start flex-col items-center justify-center gap-3 rounded-2xl border border-surface-border bg-surface-alt/40 p-6 text-center transition hover:bg-surface-alt hover:shadow-card [scroll-snap-stop:always] sm:w-[calc((100%-2.5rem)/3)] lg:w-[calc((100%-3.75rem)/4)] xl:w-[calc((100%-5rem)/5)]"
                prefetch
              >
                <div className="relative aspect-square w-[80px] mx-auto rounded-2xl overflow-visible flex items-center justify-center">
                  {/* Airbnb-style stacked preview: 3 images, visually overlapped, center stack */}
                  {[0, 1, 2].map((offset) => {
                    const card = visible[offset] || listings[offset];
                    const img = card?.imageUrls?.[0] || '';
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
                        className="absolute rounded-xl border-2 border-white shadow-card bg-white overflow-hidden"
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
                        {img && <img src={img} alt="" className="h-full w-full object-cover" />}
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
            <div
              key={l.id}
              className="w-[calc((100%-1.25rem)/2)] flex-shrink-0 snap-start [scroll-snap-stop:always] sm:w-[calc((100%-2.5rem)/3)] lg:w-[calc((100%-3.75rem)/4)] xl:w-[calc((100%-5rem)/5)]"
            >
              <ListingCard listing={l} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
