'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGE_SIZE_DEFAULT } from '@cribstop/property-contracts';
import type { ListingCardRow } from '@/lib/types';
import type { SearchFilters } from '@/lib/types';
import { ListingsApiError, searchListings } from '@/lib/api/listings';
import { useToast } from '@/lib/useToast';

export interface ListingSearchResult {
  results: ListingCardRow[];
  /** The exact count of the full filtered set — what the headline count and paging are built on. */
  total: number;
  /**
   * The page this hook is currently searching for — not the last one that happened to succeed.
   * A resolved response may override it (the server clamps an out-of-range page), and only for as
   * long as that response answers the page being asked for.
   */
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
 * What the hook stores, as opposed to what it reports.
 *
 * The difference is `page`. State only ever learns a page when a request *resolves*, so storing the
 * reported page here is what made it stale: a new search spread the previous state while it flipped
 * to `loading`, and a failed one spread it forever, so a paging UI highlighted the last page that
 * succeeded rather than the one being fetched — permanently, after an error. The requested page is
 * an argument this hook already has on every render, so it is reported from there and the response's
 * page is kept only as an `echo` of the request it answered.
 */
interface SearchState extends Omit<ListingSearchResult, 'retry' | 'page'> {
  /**
   * The page a resolved response reported, paired with the page that request asked for — so a
   * server-clamped page can win without outliving the request it belongs to. `null` until the first
   * response settles.
   */
  echo: { requested: number; applied: number } | null;
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
  const [state, setState] = useState<SearchState>({
    results: [],
    total: 0,
    echo: null,
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

    searchListings({ ...filtersRef.current, page, pageSize: PAGE_SIZE_DEFAULT }, controller.signal)
      .then((envelope) => {
        if (!active) return;
        setState({
          results: envelope.results,
          total: envelope.total,
          echo: { requested: page, applied: envelope.page },
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

  const { echo, ...rest } = state;

  /*
   * The requested page is the answer except in the one case the server knows better: it resolved
   * *this* request and clamped the page (an out-of-range page comes back as the last real one).
   * Anything else — in flight, held, failed, or an echo left over from a page no longer being
   * asked for — reports what is being searched for now.
   */
  const appliedPage = rest.status === 'ready' && echo?.requested === page ? echo.applied : page;

  return { ...rest, page: appliedPage, retry };
}
