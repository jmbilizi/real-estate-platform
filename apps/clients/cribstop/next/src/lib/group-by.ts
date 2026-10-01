import type { NeighborhoodsRequest } from '@cribstop/property-contracts';
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
}

/** An unknown value reads as "no grouping" and "order by count", never as an error. */
export function parseGroupState(params: URLSearchParams): GroupState {
  return {
    groupBy: params.get(GROUP_BY_PARAM) === 'neighborhood' ? 'neighborhood' : undefined,
    order: params.get(GROUP_ORDER_PARAM) === 'name' ? 'name' : 'count',
  };
}

/** Writes the group state into `params`. The default of each value is left out of the URL. */
export function writeGroupState(params: URLSearchParams, state: GroupState): URLSearchParams {
  params.delete(GROUP_BY_PARAM);
  params.delete(GROUP_ORDER_PARAM);
  if (state.groupBy) {
    params.set(GROUP_BY_PARAM, state.groupBy);
    if (state.order === 'name') params.set(GROUP_ORDER_PARAM, 'name');
  }
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

/** The filters that show one neighborhood's listings. `city` and `state` keep a name from colliding. */
export function drillDownFilters(
  filters: SearchFilters,
  n: { name: string; city: string; state: string },
): SearchFilters {
  return { ...filters, neighborhood: n.name, city: n.city, state: n.state };
}

/**
 * The filters for the way back to the grouped view. The neighborhood goes. `city` and `state` go
 * too when a text, ZIP or map-area scope is present, because that scope is what the drill-down
 * narrowed.
 */
export function backToGroupFilters(filters: SearchFilters): SearchFilters {
  const next = { ...filters };
  delete next.neighborhood;
  if (next.query || next.zip || next.boundary) {
    delete next.city;
    delete next.state;
  }
  return next;
}
