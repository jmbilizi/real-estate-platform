'use client';

import { useCallback } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
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

type GroupQuery = ReturnType<typeof groupRequestQuery>;

/** The Query options of one group endpoint (`lib/query/search.ts`) and how to read its rows. */
export interface GroupSource<Row, Res> {
  options: (query: GroupQuery) => UseQueryOptions<Res>;
  toPage: (res: Res) => { rows: Row[]; total: number };
}

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
 * Fetches one page of group cards for the search. Held while `enabled` is false. The key holds the
 * endpoint and the request, so the home page and the search page share a cached answer. There is
 * no previous page kept: a toggle or a page change never shows the previous rows.
 */
export function useGroupPage<Row, Res>(
  source: GroupSource<Row, Res>,
  failure: string,
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): GroupPageResult<Row> {
  const query = useQuery({
    ...source.options(groupRequestQuery(filters, page, order)),
    enabled,
  });
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  const answer = query.data === undefined ? null : source.toPage(query.data);
  return {
    rows: answer?.rows ?? [],
    total: answer?.total ?? 0,
    status: query.isError ? 'error' : answer ? 'ready' : 'loading',
    error: query.isError ? shownError(query.error, failure) : null,
    retry,
  };
}
