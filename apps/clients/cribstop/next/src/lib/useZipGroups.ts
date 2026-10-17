'use client';

import { useQuery } from '@tanstack/react-query';
import type { ZipGroup, ZipsResponse } from '@cribstop/property-contracts';
import { zipGroupsOptions } from '@/lib/query/search';
import { type GroupOrder, zipProbeQuery } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';
import { type GroupPageResult, type GroupSource, useGroupPage } from '@/lib/useGroupPage';

export type ZipGroupsResult = GroupPageResult<ZipGroup>;

const FAILURE = 'We could not load ZIP codes just now. Please try again.';

const source: GroupSource<ZipGroup, ZipsResponse> = {
  options: zipGroupsOptions,
  toPage: (res) => ({ rows: res.groups, total: res.total }),
};

/** Fetches one page of ZIP code groups for the search. Held while `enabled` is false. */
export function useZipGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): ZipGroupsResult {
  return useGroupPage(source, FAILURE, filters, page, order, enabled);
}

/**
 * How many ZIP codes the search spans (#722), read with a one-group request. `null` until the
 * answer arrives, and after a failed request: a failure never offers the option. A search with a
 * `zip` filter is never asked, because it spans one ZIP code.
 */
export function useZipTotal(filters: SearchFilters, enabled: boolean): number | null {
  const active = enabled && !filters.zip;
  const { data } = useQuery({ ...zipGroupsOptions(zipProbeQuery(filters)), enabled: active });
  return active && data ? data.total : null;
}
