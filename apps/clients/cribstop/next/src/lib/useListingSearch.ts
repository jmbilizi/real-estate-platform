'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_DEFAULT } from '@cribstop/property-contracts';
import type { ListingsEnvelope } from '@cribstop/property-contracts';
import type { ListingCardRow } from '@/lib/types';
import type { SearchFilters } from '@/lib/types';
import { ListingsApiError, type ListingsErrorCode } from '@/lib/api/listings';
import { requestKey, searchResultsOptions } from '@/lib/query/search';
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
  /**
   * The page size the API actually applied, echoed back in the envelope.
   *
   * Reported rather than kept private because paging depth is bounded by an OFFSET (#65), so the
   * deepest reachable page depends on this value. A caller that clamps its pager against a page
   * size it merely assumes is one edit away from offering pages the API refuses; reading back what
   * was applied removes the assumption. Falls back to the requested default until the first
   * response settles.
   */
  pageSize: number;
  /** Echoed back by the API so the UI can reconcile what it asked for with what was applied. */
  appliedFilters: Record<string, unknown>;
  status: 'loading' | 'ready' | 'error';
  /** A user-facing message from the API error, not one invented here. */
  error: string | null;
  /**
   * The contract error code behind `error`, or null when the failure carried none.
   *
   * Exposed so a caller can distinguish a failure worth retrying from one that is deterministic —
   * `result_window_exceeded` will answer identically forever, so offering "Try again" for it is
   * offering a button that cannot work.
   */
  errorCode: ListingsErrorCode | null;
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
  initial?: ListingsEnvelope,
): ListingSearchResult {
  const { toast } = useToast();
  const request = { ...filters, page, pageSize: PAGE_SIZE_DEFAULT };

  // #841. The server's first page seeds the cache for the first request only. A later filter or
  // page change has a new key and fetches. The first paint holds the cards.
  const seedKey = useRef<string | null>(requestKey(request));
  const seeded = initial !== undefined && seedKey.current === requestKey(request);
  useEffect(() => {
    seedKey.current = null;
  }, []);

  const query = useQuery({
    ...searchResultsOptions(request, { initialData: seeded ? initial : undefined }),
    enabled,
  });

  // A failed search keeps the last good page on screen, as the hook did before Query.
  const last = useRef<ListingsEnvelope | undefined>(undefined);
  if (query.data) last.current = query.data;
  const envelope = query.data ?? last.current;

  const { error, errorUpdatedAt, refetch } = query;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (error) toastRef.current(messageOf(error), 'error');
    // Only a new failure shows a toast.
  }, [error, errorUpdatedAt]);

  const retry = useCallback(() => void refetch(), [refetch]);

  const status = query.isError
    ? 'error'
    : query.data && !query.isPlaceholderData
      ? 'ready'
      : 'loading';
  // The server clamps an out-of-range page. Its answer counts only for the request it answers.
  const appliedPage = status === 'ready' && query.data ? query.data.page : page;

  return {
    results: envelope?.results ?? [],
    total: envelope?.total ?? 0,
    page: appliedPage,
    pageCount: envelope?.pageCount ?? 1,
    pageSize: envelope?.pageSize ?? PAGE_SIZE_DEFAULT,
    appliedFilters: envelope?.appliedFilters ?? {},
    status,
    error: query.isError ? messageOf(error) : null,
    errorCode: error instanceof ListingsApiError ? error.code : null,
    retry,
  };
}

function messageOf(error: unknown): string {
  return error instanceof ListingsApiError
    ? error.message
    : 'We could not load listings just now. Please try again.';
}
