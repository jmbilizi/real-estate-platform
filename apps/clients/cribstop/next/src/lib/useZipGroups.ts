'use client';

import { useEffect, useState } from 'react';
import type { ZipGroup } from '@cribstop/property-contracts';
import { getZipGroups } from '@/lib/api/listings';
import { type GroupOrder, zipProbeQuery } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';
import { type GroupPageResult, useGroupPage } from '@/lib/useGroupPage';

export type ZipGroupsResult = GroupPageResult<ZipGroup>;

const FAILURE = 'We could not load ZIP codes just now. Please try again.';

const fetchPage = (query: Parameters<typeof getZipGroups>[0], signal: AbortSignal) =>
  getZipGroups(query, signal).then((res) => ({ rows: res.groups, total: res.total }));

/** Fetches one page of ZIP code groups for the search. Held while `enabled` is false. */
export function useZipGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): ZipGroupsResult {
  return useGroupPage(fetchPage, FAILURE, filters, page, order, enabled);
}

/**
 * How many ZIP codes the search spans (#722), read with a one-group request. `null` until the
 * answer arrives, and after a failed request: a failure never offers the option. A search with a
 * `zip` filter is never asked, because it spans one ZIP code.
 */
export function useZipTotal(filters: SearchFilters, enabled: boolean): number | null {
  const [answer, setAnswer] = useState<{ key: string; total: number } | null>(null);
  const key = JSON.stringify(filters);
  const active = enabled && !filters.zip;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    getZipGroups(zipProbeQuery(JSON.parse(key) as SearchFilters), controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setAnswer({ key, total: res.total });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswer(null);
      });
    return () => controller.abort();
  }, [active, key]);

  return active && answer?.key === key ? answer.total : null;
}
