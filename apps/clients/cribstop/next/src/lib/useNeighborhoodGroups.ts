'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NeighborhoodRow } from '@cribstop/property-contracts';
import { getNeighborhoodGroups, ListingsApiError } from '@/lib/api/listings';
import { type GroupOrder, groupRequestQuery } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';

export interface NeighborhoodGroupsResult {
  rows: NeighborhoodRow[];
  /** The exact group count, never clamped to the page. */
  total: number;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  retry: () => void;
}

/** Fetches one page of neighborhood groups for the search. Held while `enabled` is false. */
export function useNeighborhoodGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): NeighborhoodGroupsResult {
  const [state, setState] = useState<Omit<NeighborhoodGroupsResult, 'retry'> & { answers: string }>(
    {
      answers: '',
      rows: [],
      total: 0,
      status: 'loading',
      error: null,
    },
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Keyed on the filter values, so a re-render with equal filters does not search again.
  const key = JSON.stringify(filters);
  const request = `${key}|${page}|${order}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    getNeighborhoodGroups(
      groupRequestQuery(JSON.parse(key) as SearchFilters, page, order),
      controller.signal,
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setState({
          answers: request,
          rows: res.results,
          total: res.total,
          status: 'ready',
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          answers: request,
          status: 'error',
          error:
            err instanceof ListingsApiError
              ? err.message
              : 'We could not load neighborhoods just now. Please try again.',
        }));
      });
    return () => controller.abort();
  }, [key, page, order, attempt, enabled, request]);

  // Until a response answers this request, report loading, so a toggle or a page change never
  // shows the previous rows for one frame.
  const { answers, ...rest } = state;
  const stale = answers !== request;
  return { ...rest, status: stale ? 'loading' : rest.status, retry };
}
