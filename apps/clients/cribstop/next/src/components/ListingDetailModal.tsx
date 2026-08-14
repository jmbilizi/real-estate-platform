'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Modal from './Modal';
import ListingDetailContent from './ListingDetailContent';
import { ListingDetailSkeleton, ListingErrorState } from '@/components/listing/ListingStates';
import { getListing, ListingsApiError } from '@/lib/api/listings';
import type { ListingDetailView } from '@/lib/api/listings';

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; listing: ListingDetailView }
  /** A 404 is "this listing is not available", not a failure the user should retry — a distinct,
   *  calm state rather than the generic error banner. */
  | { status: 'not-found' }
  | { status: 'error'; message: string };

export default function ListingDetailModal({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    getListing(id, controller.signal)
      .then((listing) => setState({ status: 'ready', listing }))
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
  }, [id, retryCount]);

  const handleClose = () => {
    setOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('listing');
    const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    setTimeout(() => router.replace(url, { scroll: false }), 310);
  };

  const handleRetry = () => setRetryCount((c) => c + 1);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      mobileStyle="full-screen"
      widthClass="sm:max-w-7xl"
      heightClass="sm:h-screen"
      noPadding
      squareBottom
      noScroll
      /* Full height from the first frame — this panel fills the viewport, so scaling it up from
         95% reads as the modal resizing itself rather than arriving. */
      noScaleIn
    >
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
    </Modal>
  );
}
