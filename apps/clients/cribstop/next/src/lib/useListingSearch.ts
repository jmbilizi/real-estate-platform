'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListingCardRow } from '@/lib/types';
import type { SearchFilters } from '@/lib/types';
import { ListingsApiError, searchListings } from '@/lib/api/listings';
import { useToast } from '@/lib/useToast';

const PAGE_SIZE = 20;

export interface ListingSearchResult {
  results: ListingCardRow[];
  /** The exact count of the full filtered set — what the headline count and paging are built on. */
  total: number;
  page: number;
  pageCount: number;
  /** Echoed back by the API so the UI can reconcile what it asked for with what was applied. */
  appliedFilters: Record<string, unknown>;
  status: 'loading' | 'ready' | 'error';
  /** A user-facing message from the API error, not one invented here. */
  error: string | null;
  retry: () => void;
}

/**
 * Runs a server-side listing search.
 *
 * The mock array resolved synchronously, so the search page had no loading or error states at all.
 * Both are real now: a filter combination the API rejects comes back 400 and must surface as an
 * error state rather than a blank page that looks like "no homes match".
 *
 * `enabled` holds the request without changing what the caller renders: the state stays `loading`,
 * so a held search draws the same skeleton an in-flight one does. That is what lets the results
 * behind a directly-loaded listing occupy their space from the first paint while their fetch waits
 * for the listing to be on screen — a caller that has to render nothing to delay a request is a
 * caller that flashes an empty page.
 */
export function useListingSearch(
  filters: SearchFilters,
  page: number,
  enabled = true,
): ListingSearchResult {
  const [state, setState] = useState<Omit<ListingSearchResult, 'retry'>>({
    results: [],
    total: 0,
    page,
    pageCount: 1,
    appliedFilters: {},
    status: 'loading',
    error: null,
  });

  const { toast } = useToast();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // The effect keys on the filter *values*, not on the object identity a parent re-render produces,
  // so an unchanged filter set does not re-fire the search. The current object is read through a
  // ref so the effect does not need it as a dependency.
  const filterKey = JSON.stringify(filters);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let active = true;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    searchListings({ ...filtersRef.current, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((envelope) => {
        if (!active) return;
        setState({
          results: envelope.results,
          total: envelope.total,
          page: envelope.page,
          pageCount: envelope.pageCount,
          appliedFilters: envelope.appliedFilters,
          status: 'ready',
          error: null,
        });
      })
      .catch((err: unknown) => {
        // An aborted request is a superseded search, not a failure the user should hear about.
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;

        const message =
          err instanceof ListingsApiError
            ? err.message
            : 'We could not load listings just now. Please try again.';

        setState((prev) => ({ ...prev, status: 'error', error: message }));
        toastRef.current(message, 'error');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [filterKey, page, attempt, enabled]);

  return { ...state, retry };
}

export { PAGE_SIZE };
