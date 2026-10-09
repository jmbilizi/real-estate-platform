'use client';

import { useEffect, useState } from 'react';
import type { BrokerGroup } from '@cribstop/property-contracts';
import { getBrokerGroups } from '@/lib/api/listings';
import { type GroupOrder, groupRequestQuery } from '@/lib/group-by';
import type { SearchFilters } from '@/lib/types';
import { type GroupPageResult, useGroupPage } from '@/lib/useGroupPage';

export type BrokerGroupsResult = GroupPageResult<BrokerGroup>;

const FAILURE = 'We could not load brokerages just now. Please try again.';

const fetchPage = (query: Parameters<typeof getBrokerGroups>[0], signal: AbortSignal) =>
  getBrokerGroups(query, signal).then((res) => ({ rows: res.groups, total: res.total }));

/**
 * The name for the chip of an `officeKey` filter, from the server: the office name of the most
 * recently updated listing of the group, as on the group card. A URL never supplies it. `undefined`
 * while loading, `null` when the key matches no group of the search.
 */
export function useBrokerName(filters: SearchFilters, enabled: boolean): string | null | undefined {
  const [answer, setAnswer] = useState<{ key: string; name: string | null } | null>(null);
  const key = JSON.stringify(filters);
  const active = enabled && Boolean(filters.officeKey);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const wanted = (JSON.parse(key) as SearchFilters).officeKey;
    getBrokerGroups(
      { ...groupRequestQuery(JSON.parse(key) as SearchFilters, 1, 'count'), limit: 1 },
      controller.signal,
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        const group = res.groups.find((g) => g.key === wanted);
        setAnswer({ key, name: group?.name ?? null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswer({ key, name: null });
      });
    return () => controller.abort();
  }, [active, key]);

  if (!active) return null;
  return answer?.key === key ? answer.name : undefined;
}

/** Fetches one page of listing office groups for the search. Held while `enabled` is false. */
export function useBrokerGroups(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
  enabled: boolean,
): BrokerGroupsResult {
  return useGroupPage(fetchPage, FAILURE, filters, page, order, enabled);
}
