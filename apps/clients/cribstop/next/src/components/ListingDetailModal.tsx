'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import ListingDetailContent from './ListingDetailContent';
import ListingModalFrame from '@/components/listing/ListingModalFrame';
import { ListingDetailSkeleton, ListingErrorPanel } from '@/components/listing/ListingStates';
import { ListingsApiError } from '@/lib/api/listings';
import type { ListingDetailState } from '@/lib/api/listings';
import { listingDetailOptions } from '@/lib/query/listings';
import type { ListingCardRow } from '@/lib/types';

export default function ListingDetailModal({
  id,
  onClosed,
  initialState,
  layoutRow,
  statusLabel,
  nearby,
  propertyPanel,
}: {
  id: string;
  /**
   * What to do once the close animation has finished.
   *
   * The two ways a listing opens undo themselves differently, and neither is a navigation. A **soft**
   * open pushed a history entry (`lib/listing-panel`), so closing steps back and the page underneath
   * — never unmounted — is simply revealed again. A **direct load** has no entry behind it; that case
   * reveals the results it rendered behind the panel and rewrites the URL in place. Both are supplied
   * by the caller; the `router.back()` below is only the fallback for a bare render, which today is
   * tests.
   */
  onClosed?: () => void;
  /**
   * The listing, already resolved server-side. Supplied only by the standalone `/listing/[id]`
   * route; the intercepted route leaves it out and lets the modal open instantly on a skeleton,
   * which is the right trade when the page behind it is already on screen.
   */
  initialState?: ListingDetailState;
  /**
   * The card row this open started from, when it started from one.
   *
   * **Measurement only.** Nothing from it is ever drawn — the loading state is uniformly skeletal.
   * It lets that state reserve the right boxes: whether the mortgage panel is held at all (the
   * loaded page renders it only for a sale with a price), how many amenity chips to hold room for,
   * and whether the gallery is the mosaic or the single block a listing with no media gets. It
   * never becomes `state`, because a card row is not a detail and must not be mistaken for one.
   */
  layoutRow?: ListingCardRow;
  /** Property page extras (#382), passed through to `ListingDetailContent` unchanged. */
  statusLabel?: string;
  nearby?: ListingCardRow[];
  propertyPanel?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [retried, setRetried] = useState(false);

  // A server-resolved failure renders as given until the user retries. A server-resolved listing
  // seeds the cache and counts as fresh, so it costs no request. Reopening a cached listing renders
  // on the first pass with no skeleton.
  const serverFailure =
    !retried && (initialState?.status === 'not-found' || initialState?.status === 'error')
      ? initialState
      : null;
  const query = useQuery({
    ...listingDetailOptions(id),
    initialData: initialState?.status === 'ready' ? initialState.listing : undefined,
    enabled: serverFailure === null,
  });

  let state: ListingDetailState = { status: 'loading' };
  if (serverFailure) state = serverFailure;
  else if (query.data) state = { status: 'ready', listing: query.data };
  else if (query.error instanceof ListingsApiError && query.error.isNotFound)
    state = { status: 'not-found' };
  else if (query.error)
    state = {
      status: 'error',
      message:
        query.error instanceof ListingsApiError
          ? query.error.message
          : 'We could not load this listing just now. Please try again.',
    };

  /**
   * The delay is the exit animation: the panel finishes sliding out, and only then does `onClosed`
   * take the URL and the panel's mount with it. Reversing the order would snap it off the screen.
   *
   * The timer is held and guarded because it moves history. `onClosed` steps back an entry for a
   * soft open, so firing it twice runs `history.back()` twice: the second pop leaves the search page
   * altogether, and returning to it is a fresh mount and a full refetch — precisely the round trip
   * this panel exists to avoid. Two ways in: double-clicking the back chevron, and pressing browser
   * Back within the 310ms window, which unmounts this component while the timer is still pending.
   * The `open` guard closes the first, the cleanup closes the second.
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const handleClose = () => {
    // Already closing — the timer from the first call still owns the history step.
    if (!open) return;
    setOpen(false);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (onClosed) onClosed();
      else router.back();
    }, 310);
  };

  const handleRetry = () => {
    if (serverFailure) setRetried(true);
    else void query.refetch();
  };

  return (
    <ListingModalFrame open={open} onClose={handleClose}>
      {state.status === 'loading' && <ListingDetailSkeleton layoutRow={layoutRow} />}

      {state.status === 'ready' && (
        <ListingDetailContent
          listing={state.listing}
          onClose={handleClose}
          statusLabel={statusLabel}
          nearby={nearby}
          propertyPanel={propertyPanel}
        />
      )}

      {state.status === 'not-found' && (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-5xl">🏠</p>
          <h1 className="mt-4 font-display text-2xl font-bold">
            This listing is no longer available
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
            It may have been sold, rented, or removed by the seller.
          </p>
          <a href="/homes-for-sale?type=all" className="btn-primary mt-4">
            Browse all homes
          </a>
        </div>
      )}

      {state.status === 'error' && (
        <ListingErrorPanel message={state.message} onRetry={handleRetry} onClose={handleClose} />
      )}
    </ListingModalFrame>
  );
}
