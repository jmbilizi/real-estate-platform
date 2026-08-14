'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ListingDetailContent from './ListingDetailContent';
import ListingModalFrame from '@/components/listing/ListingModalFrame';
import { ListingDetailSkeleton, ListingErrorState } from '@/components/listing/ListingStates';
import { getListing, ListingsApiError } from '@/lib/api/listings';
import type { ListingDetailState } from '@/lib/api/listings';
import { cacheListing, readCachedListing } from '@/lib/api/listings-cache';

/**
 * The state to start from, or `null` when the listing has to be fetched.
 *
 * Two things can resolve a listing before the modal ever renders. A direct load of `/listing/[id]`
 * resolves it on the server and passes it down, so the panel arrives populated in the first HTML.
 * A listing opened earlier in the session is in the detail cache, so reopening it costs nothing.
 * Either way there is no request and no skeleton.
 *
 * Client-only on purpose: the cache is a per-tab module, so reading it while rendering on the
 * server would both consult the wrong process's memory and risk a hydration mismatch. The direct
 * load — the one path that does render this on the server — always supplies `initialState`, which
 * takes precedence, so the cache is never the thing the two sides could disagree about.
 */
function seedState(id: string, initialState?: ListingDetailState): ListingDetailState | null {
  if (initialState) return initialState;
  if (typeof window === 'undefined') return null;

  const cached = readCachedListing(id);
  return cached ? { status: 'ready', listing: cached } : null;
}

export default function ListingDetailModal({
  id,
  onClosed,
  initialState,
}: {
  id: string;
  /**
   * What to do once the close animation has finished, for the case where stepping back through
   * history is not the answer.
   *
   * An intercepted open has the page you came from sitting in history, so closing is just
   * `router.back()` and the page underneath is restored exactly as it was. A direct load — a shared
   * link, a bookmark, a reload — has no such entry; that case passes this, and handles closing by
   * revealing the results it already rendered behind the panel rather than by navigating anywhere.
   */
  onClosed?: () => void;
  /**
   * The listing, already resolved server-side. Supplied only by the standalone `/listing/[id]`
   * route; the intercepted route leaves it out and lets the modal open instantly on a skeleton,
   * which is the right trade when the page behind it is already on screen.
   */
  initialState?: ListingDetailState;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<ListingDetailState>(
    () => seedState(id, initialState) ?? { status: 'loading' },
  );
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // A retry must always go back to the API — that is what the user is asking for — so it ignores
    // both the server-supplied state and the cache.
    const seeded = retryCount === 0 ? seedState(id, initialState) : null;

    if (seeded) {
      setState(seeded);
      // Seeding from the server still populates the cache, so closing and reopening this listing
      // is free even though the first render never went through the client fetch path.
      if (seeded.status === 'ready') cacheListing(seeded.listing);
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });

    getListing(id, controller.signal)
      .then((listing) => {
        cacheListing(listing);
        setState({ status: 'ready', listing });
      })
      .catch((err) => {
        // A fast modal close aborts the in-flight fetch — never set state on an unmounted /
        // superseded component for that case.
        if (err instanceof DOMException && err.name === 'AbortError') return;

        if (err instanceof ListingsApiError && err.isNotFound) {
          setState({ status: 'not-found' });
          return;
        }

        setState({
          status: 'error',
          message:
            err instanceof ListingsApiError
              ? err.message
              : 'We could not load this listing just now. Please try again.',
        });
      });

    return () => controller.abort();
  }, [id, retryCount, initialState]);

  /**
   * Intercepted: step back through history, which unwinds the interception and restores the page
   * underneath exactly as it was — its filters, its results, its scroll position. Standalone:
   * `onClosed` does the equivalent for a page that was never in history.
   *
   * The delay lets the panel finish animating out before either happens.
   */
  const handleClose = () => {
    setOpen(false);
    setTimeout(() => (onClosed ? onClosed() : router.back()), 310);
  };

  const handleRetry = () => setRetryCount((c) => c + 1);

  return (
    <ListingModalFrame open={open} onClose={handleClose}>
      {state.status === 'loading' && <ListingDetailSkeleton />}

      {state.status === 'ready' && (
        <ListingDetailContent listing={state.listing} onClose={handleClose} />
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
          <a href="/search" className="btn-primary mt-4">
            Browse all homes
          </a>
        </div>
      )}

      {state.status === 'error' && (
        <ListingErrorState message={state.message} onRetry={handleRetry} className="my-16" />
      )}
    </ListingModalFrame>
  );
}
