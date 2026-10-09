'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { CARD_HOVER_CLASS } from '@/components/cardHover';
import {
  RESULTS_GRID_COLUMNS_CLASS,
  RESULTS_GRID_GAP_CLASS,
} from '@/components/resultsGridColumns';

/** One card of a ZIP code or broker grouping (#722): a title and a count. Nothing ranks a card. */
export interface ListingGroupCard {
  key: string;
  title: string;
  count: number;
}

/** Same columns (#517) and gap (#519) as the listing grid and the neighborhood grid. */
const GROUP_GRID_CLASS = `grid ${RESULTS_GRID_GAP_CLASS} ${RESULTS_GRID_COLUMNS_CLASS}`;

/** Every card has this box. The skeleton uses the same one, so a grid never shifts when data lands. */
const CARD_BOX_CLASS =
  'flex min-h-24 w-full min-w-0 flex-col items-center justify-center rounded-md border border-surface-border bg-white px-3 py-4 text-center';

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
          <div className="h-5 w-2/3 rounded bg-surface-soft skeleton-fill" />
          <div className="mt-2 h-4 w-1/3 rounded bg-surface-soft skeleton-fill" />
        </div>
      ))}
    </div>
  );
}

/**
 * The grouped results of a ZIP code or broker grouping. Every card has the same style. The cards
 * come in the order the service gives them. The whole card is one link.
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
          <span className="w-full break-words font-display text-base font-bold leading-6 text-ink group-hover:underline">
            {card.title}
          </span>
          <span className="mt-1 text-sm leading-5 text-ink-muted">
            {card.count.toLocaleString()} {card.count === 1 ? 'home' : 'homes'}
          </span>
        </Link>
      ))}
    </div>
  );
}
