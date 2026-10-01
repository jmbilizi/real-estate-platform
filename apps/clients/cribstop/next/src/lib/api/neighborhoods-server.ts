import {
  type NeighborhoodRow as NeighborhoodApiRow,
  neighborhoodsResponseSchema,
} from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import type { Neighborhood } from '@/components/NeighborhoodRow';
import {
  addNeighborhoodRows,
  NEIGHBORHOODS_MIN_COUNT,
  NEIGHBORHOODS_PAGE_LIMIT,
  type NeighborhoodsScope,
  scopeStates,
  stateName,
} from '@/lib/neighborhoods';

/**
 * Server-side loader for the `/neighborhoods` page (#493). **Server modules only.** It reads
 * `API_GATEWAY_URL` through `fetchGateway`, as `listings-server.ts` does.
 */

const TIMEOUT_MS = 10_000;

export interface NeighborhoodsSection {
  key: string;
  heading: string;
  neighborhoods: Neighborhood[];
  /** The state returned the API maximum, so more may exist. */
  truncated: boolean;
}

async function fetchRows(params: Record<string, string>): Promise<NeighborhoodApiRow[]> {
  const query = new URLSearchParams({
    ...params,
    limit: String(NEIGHBORHOODS_PAGE_LIMIT),
    minCount: String(NEIGHBORHOODS_MIN_COUNT),
  });
  const res = await fetchGateway(
    `/property/listings/neighborhoods?${query}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`neighborhoods ${res.status}`);
  return neighborhoodsResponseSchema.parse(await res.json()).results;
}

/**
 * One request per state, plus one for the city when the scope names one. `allSettled`, so one
 * failed request leaves the others' rows in place. Order follows the scope, never settle order.
 * Sections with no rows are dropped.
 */
export async function loadNeighborhoodSections(
  scope: NeighborhoodsScope,
): Promise<NeighborhoodsSection[]> {
  const states = scopeStates(scope);
  const [cityResult, ...stateResults] = await Promise.allSettled([
    scope.kind === 'city'
      ? fetchRows({ state: scope.state, city: scope.city })
      : Promise.resolve([] as NeighborhoodApiRow[]),
    ...states.map((state) => fetchRows({ state })),
  ]);

  for (const result of [cityResult, ...stateResults]) {
    if (result?.status === 'rejected') console.error('neighborhoods request failed', result.reason);
  }

  const seen = new Set<string>();
  const sections: NeighborhoodsSection[] = [];

  if (scope.kind === 'city' && cityResult?.status === 'fulfilled') {
    const neighborhoods: Neighborhood[] = [];
    addNeighborhoodRows(cityResult.value, seen, neighborhoods);
    if (neighborhoods.length > 0) {
      sections.push({
        key: `city-${scope.state}`,
        heading: `${scope.city}, ${scope.state}`,
        neighborhoods,
        truncated: cityResult.value.length >= NEIGHBORHOODS_PAGE_LIMIT,
      });
    }
  }

  states.forEach((state, i) => {
    const result = stateResults[i];
    if (result?.status !== 'fulfilled') return;
    const neighborhoods: Neighborhood[] = [];
    addNeighborhoodRows(result.value, seen, neighborhoods);
    if (neighborhoods.length === 0) return;
    sections.push({
      key: state,
      heading: scope.kind === 'city' ? `More in ${stateName(state)}` : stateName(state),
      neighborhoods,
      truncated: result.value.length >= NEIGHBORHOODS_PAGE_LIMIT,
    });
  });

  return sections;
}
