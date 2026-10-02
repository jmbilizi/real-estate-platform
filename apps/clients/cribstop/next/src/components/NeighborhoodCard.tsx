'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { type NeighborhoodPreviewPhoto, searchPath } from '@cribstop/property-contracts';
import { CARD_ACTIVE_CLASS, CARD_HOVER_CLASS } from '@/components/cardHover';
import NeighborhoodPhotoStack, { PHOTO_AREA_CLASS } from '@/components/NeighborhoodPhotoStack';
import { searchTargetUrl } from '@/lib/search-place';

/** One neighborhood card (#393): name, place and counts, sourced from real data. */
export interface Neighborhood {
  name: string;
  city: string;
  state: string;
  /** Matching for-sale count. */
  sale: number;
  /** Matching for-rent count. */
  rent: number;
  /** Live listing photos from the card's own search results (#486), 0 to 5. */
  previewPhotos?: NeighborhoodPreviewPhoto[];
}

/** The card fills the width its container gives it. Only the container differs (#534). */
const CARD_BOX_CLASS = 'w-full min-w-0';

const COUNT_LINK_CLASS =
  'flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded px-0 text-center text-[11px] font-semibold sm:text-xs leading-tight text-ink-muted hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';

/**
 * The one neighborhood card (#534), used by the home carousel and the grouped search grid. All
 * photo, count and link markup lives here. Callers pass data and handlers, never content.
 *
 * The main link is the name, stretched over the whole card by a pseudo-element (#492). The count
 * links are siblings above it (`z-10`), never nested inside it. Each count link is `min-h-11` and
 * takes its own half of the row, so the two hit areas never overlap.
 */
export default function NeighborhoodCard({
  n,
  hrefFor,
  onSelect,
  sync,
}: {
  n: Neighborhood;
  /** Links the card to its map marker (#503). Hover and focus on the card report its key. */
  sync?: { key: string; active: boolean; onActive: (key: string | null) => void };
  /** Replaces the target of the name link (no type) and of each count link (#502). */
  hrefFor?: (listingType?: 'sale' | 'rent') => string;
  /** Runs on a plain click of those links, in place of the navigation (#502). */
  onSelect?: (listingType?: 'sale' | 'rent') => void;
}) {
  const place = { kind: 'neighborhood', name: n.name, city: n.city, state: n.state } as const;
  const href = hrefFor ? hrefFor() : searchTargetUrl({ kind: 'place', place }, 'all');
  const onClickFor = (listingType?: 'sale' | 'rent') =>
    onSelect
      ? (e: MouseEvent) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onSelect(listingType);
        }
      : undefined;

  return (
    <div
      data-neighborhood-key={sync?.key}
      data-active={sync?.active ? 'true' : undefined}
      onMouseEnter={sync && (() => sync.onActive(sync.key))}
      onMouseLeave={sync && (() => sync.onActive(null))}
      onFocus={sync && (() => sync.onActive(sync.key))}
      onBlur={sync && (() => sync.onActive(null))}
      className={`group relative flex flex-col items-center rounded-md border bg-white px-2 py-3 text-center sm:px-3 ${CARD_BOX_CLASS} ${CARD_HOVER_CLASS} ${sync?.active ? CARD_ACTIVE_CLASS : 'border-surface-border'}`}
    >
      <NeighborhoodPhotoStack photos={n.previewPhotos ?? []} />
      <h3 className="w-full truncate font-display text-base font-bold leading-6 text-ink">
        <Link
          href={href}
          onClick={onClickFor()}
          className="after:absolute after:inset-0 after:rounded-md after:content-[''] group-hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ink"
        >
          {n.name}
        </Link>
      </h3>
      <p className="w-full truncate text-sm leading-5 text-ink-muted">
        {n.city}, {n.state}
      </p>
      {/* A zero count renders nothing. The request needs at least one matching listing
       *  (`minCount`), so a card never has two zero counts. */}
      <div className="relative z-10 mt-1 flex w-full">
        {n.sale > 0 && (
          <Link
            href={hrefFor ? hrefFor('sale') : searchPath(place, 'homes-for-sale')}
            onClick={onClickFor('sale')}
            aria-label={`${n.sale.toLocaleString()} for sale in ${n.name}`}
            className={COUNT_LINK_CLASS}
          >
            {n.sale.toLocaleString()} for sale
          </Link>
        )}
        {n.rent > 0 && (
          <Link
            href={hrefFor ? hrefFor('rent') : searchPath(place, 'homes-for-rent')}
            onClick={onClickFor('rent')}
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

/** Most photos the "See all" card may draw from. The stack shows 3, the rest replace failed loads. */
const SEE_ALL_PHOTO_POOL = 5;

/**
 * Photos for the "See all" card (#495): one per card first, then the extras. Every photo comes
 * from a card already in the row, so each is a listing in a target the row links to.
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
 * Trailing card (#495). Same box as `NeighborhoodCard`. The whole card is one link. With no photo
 * the stack shows its placeholder.
 */
export function SeeAllCard({
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
      className={`group flex min-h-11 flex-col items-center rounded-md border border-surface-border bg-surface-alt/40 px-2 py-3 text-center sm:px-3 ${CARD_BOX_CLASS} ${CARD_HOVER_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
    >
      <NeighborhoodPhotoStack photos={photos} />
      <span className="w-full truncate font-display text-base font-bold leading-6 text-ink group-hover:underline">
        See all
      </span>
    </Link>
  );
}

/** Same box structure as `NeighborhoodCard`, so a row never shifts height once data lands. */
export function NeighborhoodCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col items-center rounded-md border border-surface-border bg-white px-2 py-3 sm:px-3 ${CARD_BOX_CLASS}`}
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
