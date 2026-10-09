'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import type { BrokerGroup, NeighborhoodPreviewPhoto, ZipGroup } from '@cribstop/property-contracts';
import { CARD_HOVER_CLASS } from '@/components/cardHover';
import NeighborhoodPhotoStack, { PHOTO_AREA_CLASS } from '@/components/NeighborhoodPhotoStack';
import {
  RESULTS_GRID_COLUMNS_CLASS,
  RESULTS_GRID_GAP_CLASS,
} from '@/components/resultsGridColumns';

/** One card of a ZIP code or broker grouping (#722): photos, a title and a count. Nothing ranks a card. */
export interface ListingGroupCard {
  key: string;
  title: string;
  count: number;
  /** Live listing photos of the group, the same field a neighborhood row carries (#486). */
  previewPhotos?: NeighborhoodPreviewPhoto[];
}

/** The cards of a ZIP code page. The title is the ZIP code. */
export const zipGroupCards = (rows: readonly ZipGroup[]): ListingGroupCard[] =>
  rows.map((row) => ({
    key: row.key,
    title: row.key,
    count: row.count,
    previewPhotos: row.previewPhotos,
  }));

/** The cards of a broker page. The title is the office name. */
export const brokerGroupCards = (rows: readonly BrokerGroup[]): ListingGroupCard[] =>
  rows.map((row) => ({
    key: row.key,
    title: row.name,
    count: row.count,
    previewPhotos: row.previewPhotos,
  }));

/** Same columns (#517) and gap (#519) as the listing grid and the neighborhood grid. */
const GROUP_GRID_CLASS = `grid ${RESULTS_GRID_GAP_CLASS} ${RESULTS_GRID_COLUMNS_CLASS}`;

/** The neighborhood card's box (#534). The skeleton uses the same one, so a grid never shifts. */
const CARD_BOX_CLASS =
  'flex w-full min-w-0 flex-col items-center rounded-md border border-surface-border bg-white px-2 py-3 text-center sm:px-3';

/** The grid's loading state. Same grid class and card box as the loaded grid. */
export function ListingGroupGridSkeleton({
  count = 8,
  testId,
}: {
  count?: number;
  testId: string;
}) {
  return (
    <div className={GROUP_GRID_CLASS} data-testid={testId} aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className={CARD_BOX_CLASS}>
          <div className={`${PHOTO_AREA_CLASS} rounded bg-surface-soft skeleton-fill`} />
          <div className="flex h-6 w-full items-center justify-center">
            <div className="h-4 w-3/4 rounded bg-surface-soft skeleton-fill" />
          </div>
          <div className="mt-1 flex min-h-11 w-full items-center justify-center">
            <div className="h-3 w-1/3 rounded bg-surface-soft skeleton-fill" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The grouped results of a ZIP code or broker grouping. Every card has the same style and the same
 * photo stack as a neighborhood card. The cards come in the order the service gives them. The whole
 * card is one link.
 */
export default function ListingGroupGrid({
  cards,
  hrefFor,
  onSelect,
  testId,
  describe,
}: {
  cards: readonly ListingGroupCard[];
  /** The listings link of a card, used for new-tab and copy-link. */
  hrefFor: (card: ListingGroupCard) => string;
  onSelect: (card: ListingGroupCard) => void;
  testId: string;
  /** The accessible name of a card, for example `ZIP code 20814, 12 homes`. */
  describe: (card: ListingGroupCard) => string;
}) {
  return (
    <div className={GROUP_GRID_CLASS} data-testid={testId}>
      {cards.map((card) => (
        <Link
          key={card.key}
          href={hrefFor(card)}
          aria-label={describe(card)}
          data-group-key={card.key}
          onClick={(e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onSelect(card);
          }}
          className={`group ${CARD_BOX_CLASS} ${CARD_HOVER_CLASS}`}
        >
          <NeighborhoodPhotoStack photos={card.previewPhotos ?? []} />
          <span
            title={card.title}
            className="w-full truncate font-display text-base font-bold leading-6 text-ink group-hover:underline"
          >
            {card.title}
          </span>
          <span className="flex min-h-11 w-full items-center justify-center text-sm leading-5 text-ink-muted">
            {card.count.toLocaleString()} {card.count === 1 ? 'home' : 'homes'}
          </span>
        </Link>
      ))}
    </div>
  );
}
