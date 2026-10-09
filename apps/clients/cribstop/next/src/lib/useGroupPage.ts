'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListingsApiError } from '@/lib/api/listings';
import { type GroupOrder, groupRequestQuery } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';

export interface GroupPageResult<Row> {
  rows: Row[];
  /** The exact group count, never clamped to the page. */
  total: number;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  retry: () => void;
}

type FetchPage<Row> = (
  query: ReturnType<typeof groupRequestQuery>,
  signal: AbortSignal,
) => Promise<{ rows: Row[]; total: number }>;

/**
 * A gateway timeout on one group request says "the listings service is down", which is wrong for
 * a page whose listings may load. That case shows the group failure text. Other API messages
 * (rate limit, bad request) stay, because the visitor can act on them.
 */
function shownError(err: unknown, failure: string): string {
  if (!(err instanceof ListingsApiError) || err.code === 'upstream_unavailable') return failure;
  return err.message;
}

/**
 * Fetches one page of group cards for the search. Held while `enabled` is false. `fetchPage` must
 * be a stable function: the page refetches when the filters, page, order or `enabled` change.
 */
export function useGroupPage<Row>(
  fetchPage: FetchPage<Row>,
  failure: string,
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): GroupPageResult<Row> {
  const [state, setState] = useState<Omit<GroupPageResult<Row>, 'retry'> & { answers: string }>({
    answers: '',
    rows: [],
    total: 0,
    status: 'loading',
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Keyed on the filter values, so a re-render with equal filters does not search again.
  const key = JSON.stringify(filters);
  const request = `${key}|${page}|${order}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    fetchPage(groupRequestQuery(JSON.parse(key) as SearchFilters, page, order), controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setState({
          answers: request,
          rows: res.rows,
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
          error: shownError(err, failure),
        }));
      });
    return () => controller.abort();
  }, [key, page, order, attempt, enabled, request, fetchPage, failure]);

  // Until a response answers this request, report loading, so a toggle or a page change never
  // shows the previous rows for one frame.
  const { answers, ...rest } = state;
  const stale = answers !== request;
  return { ...rest, status: stale ? 'loading' : rest.status, retry };
}
