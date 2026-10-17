'use client';

import { useCallback, useEffect, useRef } from 'react';
import { getQueryClient } from './query-client';
import { listingDetailOptions, PREFETCH_STALE_TIME_MS } from './listings';

const INTENT_DELAY_MS = 150;

/**
 * Handlers that prefetch a listing's detail once the pointer or focus rests on a card.
 * The delay skips a pointer that only crosses the card. A tap needs no prefetch, because the
 * panel opens at once and its own query starts the fetch.
 */
export function usePrefetchListing(id: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      void getQueryClient().prefetchQuery({
        ...listingDetailOptions(id),
        staleTime: PREFETCH_STALE_TIME_MS,
      });
    }, INTENT_DELAY_MS);
  }, [id, cancel]);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') schedule();
    },
    onPointerLeave: cancel,
    onFocus: schedule,
    onBlur: cancel,
  };
}
