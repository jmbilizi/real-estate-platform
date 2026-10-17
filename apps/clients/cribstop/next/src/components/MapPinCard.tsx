'use client';

import { useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import ListingCard from '@/components/ListingCard';
import { SkeletonBar } from '@/components/Skeleton';
import { ListingsApiError } from '@/lib/api/listings';
import { mapCardOptions } from '@/lib/query/map';
import type { ListingCardRow } from '@/lib/types';

/**
 * The map popup body for one pin (#549). A pin for a home on the results page shows that row. Any
 * other pin loads the same card from the card endpoint, and Query keeps a loaded card for 5 minutes, so the next
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
  const query = useQuery({ ...mapCardOptions(id), enabled: !row });
  const loaded = row ?? query.data;
  const status = loaded ? 'ready' : query.isError ? 'error' : 'loading';

  useEffect(() => {
    onLayout?.();
  }, [status, onLayout]);

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const error = query.error;
  const notFound = error instanceof ListingsApiError && error.isNotFound;

  if (loaded) {
    return <ListingCard listing={loaded} track={{ listType: 'map', rowId: 'map', position: 0 }} />;
  }

  if (status === 'loading') {
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
      <p>
        {error instanceof ListingsApiError
          ? error.message
          : 'We could not load this home. Please try again.'}
      </p>
      {!notFound && (
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
