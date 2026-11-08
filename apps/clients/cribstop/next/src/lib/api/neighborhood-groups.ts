import { cache } from 'react';
import { headers } from 'next/headers';
import {
  type NeighborhoodRow,
  NEIGHBORHOODS_LIMIT_MAX,
  neighborhoodsResponseSchema,
} from '@cribstop/property-contracts';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import {
  buildListingsQuery,
  FORWARDABLE_NEIGHBORHOODS_PARAMS,
} from '@/app/api/_lib/listings-query';
import { toSearchParams } from './listings';

/**
 * The neighborhoods of one city that have Active listings (#974), read from
 * `GET /listings/neighborhoods`. The nearby links of a neighborhood page come from it. The service
 * applies display and suppression rules, so a count never includes a suppressed row. Reads share
 * the server cache of `read-cache.ts`.
 *
 * Returns `null` on any failure. The page then omits the nearby links.
 *
 * **Server modules only.** It reads `API_GATEWAY_URL`.
 */
const compute = cache(
  async (city: string, state: string, type: 'sale' | 'rent'): Promise<NeighborhoodRow[] | null> => {
    try {
      const clientIp = clientIpOf(await headers());
      const query = buildListingsQuery(
        toSearchParams({
          city,
          state,
          listingType: type,
          status: ['Active'],
          minCount: 1,
          limit: NEIGHBORHOODS_LIMIT_MAX,
          offset: 0,
          order: 'count',
        } as never),
        FORWARDABLE_NEIGHBORHOODS_PARAMS,
      );
      const response = await proxyListingsRead('/neighborhoods', query, { cache: true, clientIp });
      if (!response.ok) return null;
      const parsed = neighborhoodsResponseSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? parsed.data.results : null;
    } catch {
      return null;
    }
  },
);

export function loadCityNeighborhoods(
  city: string,
  state: string,
  type: 'sale' | 'rent',
): Promise<NeighborhoodRow[] | null> {
  return compute(city, state, type);
}
