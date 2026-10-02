import type { NeighborhoodsRequest } from '@cribstop/property-contracts';
import { FROM_PARAM } from '@/lib/neighborhood-url';
import type { SearchFilters } from '@/lib/types';

/** The values of the results toolbar's "Group by" control (#502). */
export type GroupBy = 'neighborhood';
export type GroupOrder = NeighborhoodsRequest['order'];

/** URL parameters. Neither one is a filter: the filter serialiser leaves both in place. */
export const GROUP_BY_PARAM = 'groupBy';
export const GROUP_ORDER_PARAM = 'groupOrder';

/** Neighborhood cards per page. Matches the API default `limit`. */
export const GROUP_PAGE_SIZE = 24;

export interface GroupState {
  groupBy: GroupBy | undefined;
  order: GroupOrder;
  /** On a neighborhood path: the `from` value that says where the arrow returns to (#533). */
  from?: string;
}

/** An unknown value reads as "no grouping" and "order by count", never as an error. */
export function parseGroupState(params: URLSearchParams): GroupState {
  return {
    groupBy: params.get(GROUP_BY_PARAM) === 'neighborhood' ? 'neighborhood' : undefined,
    order: params.get(GROUP_ORDER_PARAM) === 'name' ? 'name' : 'count',
    from: params.get(FROM_PARAM) ?? undefined,
  };
}

/** Writes the group state into `params`. The default of each value is left out of the URL. */
export function writeGroupState(params: URLSearchParams, state: GroupState): URLSearchParams {
  params.delete(GROUP_BY_PARAM);
  params.delete(GROUP_ORDER_PARAM);
  if (state.groupBy) params.set(GROUP_BY_PARAM, state.groupBy);
  if (state.groupBy && state.order === 'name') params.set(GROUP_ORDER_PARAM, 'name');
  return params;
}

/**
 * The aggregate request for the current search: every filter but sort, plus paging. `minCount` is 1
 * so a neighborhood with one matching listing still appears. The cards cover the whole result set.
 */
export function groupRequestQuery(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
): SearchFilters & Pick<NeighborhoodsRequest, 'minCount' | 'limit' | 'offset' | 'order'> {
  const { sort: _sort, ...rest } = filters;
  return {
    ...rest,
    minCount: 1,
    limit: GROUP_PAGE_SIZE,
    offset: (page - 1) * GROUP_PAGE_SIZE,
    order,
  };
}
