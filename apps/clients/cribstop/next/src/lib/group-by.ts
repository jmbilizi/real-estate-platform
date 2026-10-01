import type { NeighborhoodsRequest } from '@cribstop/property-contracts';
import type { SearchFilters } from '@/lib/types';

/** The values of the results toolbar's "Group by" control (#502). */
export type GroupBy = 'neighborhood';
export type GroupOrder = NeighborhoodsRequest['order'];

/** URL parameters. Neither one is a filter: the filter serialiser leaves both in place. */
export const GROUP_BY_PARAM = 'groupBy';
export const GROUP_ORDER_PARAM = 'groupOrder';
/** On a drill-down URL: the `city|state` scope the grouped view had, so the way back restores it. */
export const GROUP_FROM_PARAM = 'groupFrom';

/** Neighborhood cards per page. Matches the API default `limit`. */
export const GROUP_PAGE_SIZE = 24;

export interface GroupState {
  groupBy: GroupBy | undefined;
  order: GroupOrder;
  /** Set only while drilled in: the grouped view's `city|state` (either part may be empty). */
  from?: string;
}

/** An unknown value reads as "no grouping" and "order by count", never as an error. */
export function parseGroupState(params: URLSearchParams): GroupState {
  return {
    groupBy: params.get(GROUP_BY_PARAM) === 'neighborhood' ? 'neighborhood' : undefined,
    order: params.get(GROUP_ORDER_PARAM) === 'name' ? 'name' : 'count',
    from: params.get(GROUP_FROM_PARAM) ?? undefined,
  };
}

/** Writes the group state into `params`. The default of each value is left out of the URL. */
export function writeGroupState(params: URLSearchParams, state: GroupState): URLSearchParams {
  params.delete(GROUP_BY_PARAM);
  params.delete(GROUP_ORDER_PARAM);
  params.delete(GROUP_FROM_PARAM);
  if (!state.groupBy && state.from !== undefined) params.set(GROUP_FROM_PARAM, state.from);
  if (state.groupBy) params.set(GROUP_BY_PARAM, state.groupBy);
  // Kept while drilled in, so the way back returns to the same order.
  if ((state.groupBy || state.from !== undefined) && state.order === 'name') {
    params.set(GROUP_ORDER_PARAM, 'name');
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
  listingType?: 'sale' | 'rent',
): SearchFilters {
  const next = { ...filters, neighborhood: n.name, city: n.city, state: n.state };
  return listingType ? { ...next, listingType } : next;
}

/**
 * The `from` value for a drill-down: the city and state the grouped view had. On a search path it
 * also holds the listing type the path showed, so the way back can return to that path.
 */
export function scopeToken(filters: SearchFilters, pathType?: string): string {
  const scope = `${filters.city ?? ''}|${filters.state ?? ''}`;
  return pathType ? `${scope}|${pathType}` : scope;
}

/**
 * The filters for the way back to the grouped view. The neighborhood goes. `city` and `state`
 * return to what `from` recorded. Without `from` (a hand-made URL), they go when a text, ZIP or
 * map-area scope is present, because that scope is what the drill-down narrowed.
 */
export function backToGroupFilters(filters: SearchFilters, from?: string): SearchFilters {
  const next = { ...filters };
  delete next.neighborhood;
  if (from !== undefined) {
    const [city = '', state = ''] = from.split('|');
    if (city) next.city = city;
    else delete next.city;
    if (state) next.state = state;
    else delete next.state;
  } else if (next.query || next.zip || next.boundary) {
    delete next.city;
    delete next.state;
  }
  return next;
}
