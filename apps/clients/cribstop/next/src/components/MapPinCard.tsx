'use client';

import { useCallback, useEffect, useState } from 'react';
import ListingCard from '@/components/ListingCard';
import { SkeletonBar } from '@/components/Skeleton';
import { ListingsApiError } from '@/lib/api/listings';
import { loadListingCard, peekListingCard } from '@/lib/listing-card-cache';
import type { ListingCardRow } from '@/lib/types';

type CardState =
  | { status: 'ready'; row: ListingCardRow }
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean };

/**
 * The map popup body for one pin (#549). A pin for a home on the results page shows that row. Any
 * other pin loads the same card from the card endpoint, and a loaded card is kept, so the next
 * click is instant. The loaded card is the shared `ListingCard`, so address masking, badges and
 * the listing disclosures are the grid's own, and only a click on the card opens the detail.
 *
 * `onLayout` fires when the body changes size, so the popup can re-measure and stay on screen.
 */
export default function MapPinCard({
  id,
  row,
  onLayout,
}: {
  id: string;
  /** The row the results page holds for this pin, when it has one. */
  row?: ListingCardRow;
  onLayout?: () => void;
}) {
  const [state, setState] = useState<CardState>(() => {
    const known = row ?? peekListingCard(id);
    return known ? { status: 'ready', row: known } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state.status === 'ready' && attempt === 0) return;
    let live = true;
    setState({ status: 'loading' });
    loadListingCard(id).then(
      (loaded) => {
        if (live) setState({ status: 'ready', row: loaded });
      },
      (error: unknown) => {
        if (!live) return;
        const notFound = error instanceof ListingsApiError && error.isNotFound;
        setState({
          status: 'error',
          message:
            error instanceof ListingsApiError
              ? error.message
              : 'We could not load this home. Please try again.',
          retryable: !notFound,
        });
      },
    );
    return () => {
      live = false;
    };
    // `state` is read once, on mount, to skip the fetch for a known row.
  }, [id, attempt]);

  useEffect(() => {
    onLayout?.();
  }, [state.status, onLayout]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.status === 'ready') return <ListingCard listing={state.row} />;

  if (state.status === 'loading') {
    // The same boxes as the card: a 4:3 photo, then the price, the facts and the address lines.
    return (
      <div role="status" aria-busy="true" aria-label="Loading home" className="block">
        <div className="relative aspect-[4/3] rounded-md bg-surface-soft skeleton-fill" />
        <div className="mt-2 space-y-1 text-sm">
          <div>
            <SkeletonBar className="w-24" />
          </div>
          <div>
            <SkeletonBar className="w-32" />
          </div>
          <div>
            <SkeletonBar className="w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-md border border-line p-3 text-sm text-ink">
      <p>{state.message}</p>
      {state.retryable && (
        <button
          type="button"
          onClick={retry}
          className="mt-2 min-h-11 rounded-md border border-ink px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Try again
        </button>
      )}
    </div>
  );
}
