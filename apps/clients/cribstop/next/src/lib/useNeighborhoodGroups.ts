'use client';

import type { NeighborhoodRow, NeighborhoodsResponse } from '@cribstop/property-contracts';
import { neighborhoodGroupsOptions } from '@/lib/query/search';
import type { GroupOrder } from '@/lib/group-by';
import { type GroupPageResult, type GroupSource, useGroupPage } from '@/lib/useGroupPage';
import type { SearchFilters } from '@/lib/types';

export type NeighborhoodGroupsResult = GroupPageResult<NeighborhoodRow>;

const FAILURE = 'We could not load neighborhoods just now. Please try again.';

const source: GroupSource<NeighborhoodRow, NeighborhoodsResponse> = {
  options: neighborhoodGroupsOptions,
  toPage: (res) => ({ rows: res.results, total: res.total }),
};

/** Fetches one page of neighborhood groups for the search. Held while `enabled` is false. */
export function useNeighborhoodGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): NeighborhoodGroupsResult {
  return useGroupPage(source, FAILURE, filters, page, order, enabled);
}
