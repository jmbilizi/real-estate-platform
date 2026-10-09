'use client';

import type { BrokerGroup } from '@cribstop/property-contracts';
import { getBrokerGroups } from '@/lib/api/listings';
import type { GroupOrder } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';
import { type GroupPageResult, useGroupPage } from '@/lib/useGroupPage';

export type BrokerGroupsResult = GroupPageResult<BrokerGroup>;

const FAILURE = 'We could not load brokerages just now. Please try again.';

const fetchPage = (query: Parameters<typeof getBrokerGroups>[0], signal: AbortSignal) =>
  getBrokerGroups(query, signal).then((res) => ({ rows: res.groups, total: res.total }));

/** Fetches one page of listing office groups for the search. Held while `enabled` is false. */
export function useBrokerGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): BrokerGroupsResult {
  return useGroupPage(fetchPage, FAILURE, filters, page, order, enabled);
}
