'use client';

import type { NeighborhoodRow } from '@cribstop/property-contracts';
import { getNeighborhoodGroups } from '@/lib/api/listings';
import type { GroupOrder } from '@/lib/group-by';
import { type GroupPageResult, useGroupPage } from '@/lib/useGroupPage';
import type { SearchFilters } from '@/lib/types';

export type NeighborhoodGroupsResult = GroupPageResult<NeighborhoodRow>;

const FAILURE = 'We could not load neighborhoods just now. Please try again.';

const fetchPage = (query: Parameters<typeof getNeighborhoodGroups>[0], signal: AbortSignal) =>
  getNeighborhoodGroups(query, signal).then((res) => ({ rows: res.results, total: res.total }));

/** Fetches one page of neighborhood groups for the search. Held while `enabled` is false. */
export function useNeighborhoodGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): NeighborhoodGroupsResult {
  return useGroupPage(fetchPage, FAILURE, filters, page, order, enabled);
}
