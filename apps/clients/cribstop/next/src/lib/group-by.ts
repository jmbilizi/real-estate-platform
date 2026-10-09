import type { ListingGroupsRequest, NeighborhoodsRequest } from '@cribstop/property-contracts';
import { FROM_PARAM } from '@/lib/neighborhood-url';
import type { SearchFilters } from '@/lib/types';

/** The values of the results toolbar's "Group by" control (#502, #722). */
export const GROUP_BY_VALUES = ['neighborhood', 'zip', 'broker'] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];
export type GroupOrder = NeighborhoodsRequest['order'];

/** URL parameters. None of them is a filter: the filter serialiser leaves all of them in place. */
export const GROUP_BY_PARAM = 'groupBy';
export const GROUP_ORDER_PARAM = 'groupOrder';
/** Set when a group card opened the search: names the group type, so the chip can go back. */
export const GROUP_DRILL_PARAM = 'groupDrill';
/** The display name of the opened broker group, for the chip. It is not a filter. */
export const GROUP_LABEL_PARAM = 'groupLabel';
const GROUP_LABEL_MAX = 120;

/** Group cards per page. Matches the API default `limit`. */
export const GROUP_PAGE_SIZE = 24;

export interface GroupState {
  groupBy: GroupBy | undefined;
  order: GroupOrder;
  /** On a neighborhood path: the `from` value that says where the arrow returns to (#533). */
  from?: string;
  /** The group type of the card the user opened. The filter chip returns to that grouped view. */
  drill?: GroupBy;
  /** The name the chip shows for a broker drill-down. */
  drillLabel?: string;
}

const isGroupBy = (value: string | null): value is GroupBy =>
  GROUP_BY_VALUES.some((known) => known === value);

/** An unknown value reads as "no grouping" and "order by count", never as an error. */
export function parseGroupState(params: URLSearchParams): GroupState {
  const groupBy = params.get(GROUP_BY_PARAM);
  const drill = params.get(GROUP_DRILL_PARAM);
  return {
    groupBy: isGroupBy(groupBy) ? groupBy : undefined,
    order: params.get(GROUP_ORDER_PARAM) === 'name' ? 'name' : 'count',
    from: params.get(FROM_PARAM) ?? undefined,
    drill: isGroupBy(drill) ? drill : undefined,
    drillLabel: params.get(GROUP_LABEL_PARAM)?.slice(0, GROUP_LABEL_MAX) || undefined,
  };
}

/** Writes the group state into `params`. The default of each value is left out of the URL. */
export function writeGroupState(params: URLSearchParams, state: GroupState): URLSearchParams {
  params.delete(GROUP_BY_PARAM);
  params.delete(GROUP_ORDER_PARAM);
  params.delete(GROUP_DRILL_PARAM);
  params.delete(GROUP_LABEL_PARAM);
  if (state.groupBy) params.set(GROUP_BY_PARAM, state.groupBy);
  if (state.groupBy && state.order === 'name') params.set(GROUP_ORDER_PARAM, 'name');
  if (state.drill) params.set(GROUP_DRILL_PARAM, state.drill);
  if (state.drill === 'broker' && state.drillLabel) {
    params.set(GROUP_LABEL_PARAM, state.drillLabel.slice(0, GROUP_LABEL_MAX));
  }
  return params;
}

type GroupPaging = Pick<ListingGroupsRequest, 'minCount' | 'limit' | 'offset' | 'order'>;

/**
 * The aggregate request for the current search: every filter but sort, plus paging. `minCount` is 1
 * so a group with one matching listing still appears. The cards cover the whole result set.
 */
export function groupRequestQuery(
  filters: SearchFilters,
  page: number,
  order: GroupOrder,
): SearchFilters & GroupPaging {
  const { sort: _sort, ...rest } = filters;
  return {
    ...rest,
    minCount: 1,
    limit: GROUP_PAGE_SIZE,
    offset: (page - 1) * GROUP_PAGE_SIZE,
    order,
  };
}

/**
 * The ZIP probe request (#722): the search filters with one group. The response `total` says how
 * many ZIP codes the search spans.
 */
export function zipProbeQuery(filters: SearchFilters): SearchFilters & GroupPaging {
  return { ...groupRequestQuery(filters, 1, 'count'), limit: 1 };
}

/** The ZIP option needs a search that spans more than one ZIP code. */
export const zipOptionAvailable = (zipTotal: number | null): boolean =>
  zipTotal !== null && zipTotal > 1;
