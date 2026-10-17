'use client';

import { useQuery } from '@tanstack/react-query';
import type { BrokerGroup, BrokersResponse } from '@cribstop/property-contracts';
import { brokerGroupsOptions } from '@/lib/query/search';
import { type GroupOrder, groupRequestQuery } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';
import { type GroupPageResult, type GroupSource, useGroupPage } from '@/lib/useGroupPage';

export type BrokerGroupsResult = GroupPageResult<BrokerGroup>;

const FAILURE = 'We could not load brokerages just now. Please try again.';

const source: GroupSource<BrokerGroup, BrokersResponse> = {
  options: brokerGroupsOptions,
  toPage: (res) => ({ rows: res.groups, total: res.total }),
};

/**
 * The name for the chip of an `officeKey` filter, from the server: the office name of the most
 * recently updated listing of the group, as on the group card. A URL never supplies it. `undefined`
 * while loading, `null` when the key matches no group of the search.
 */
export function useBrokerName(filters: SearchFilters, enabled: boolean): string | null | undefined {
  const active = enabled && Boolean(filters.officeKey);
  const { data, isError } = useQuery({
    ...brokerGroupsOptions({ ...groupRequestQuery(filters, 1, 'count'), limit: 1 }),
    enabled: active,
  });
  if (!active) return null;
  if (isError) return null;
  return data ? (data.groups.find((g) => g.key === filters.officeKey)?.name ?? null) : undefined;
}

/** Fetches one page of listing office groups for the search. Held while `enabled` is false. */
export function useBrokerGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): BrokerGroupsResult {
  return useGroupPage(source, FAILURE, filters, page, order, enabled);
}
