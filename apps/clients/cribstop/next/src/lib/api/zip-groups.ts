import { cache } from 'react';
import { headers } from 'next/headers';
import { type ZipGroup, zipsResponseSchema } from '@cribstop/property-contracts';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery, FORWARDABLE_GROUPS_PARAMS } from '@/app/api/_lib/listings-query';
import { GROUP_PAGE_SIZE } from '@/lib/group-by';
import { toSearchParams } from './listings';

/**
 * The ZIP codes of one city that have Active listings (#973), read from `GET /listings/zips`. The
 * nearby links of a ZIP page come from it. The service applies display and suppression rules, so a
 * count never includes a suppressed row. Reads share the server cache of `read-cache.ts`.
 *
 * Returns `null` on any failure. The page then omits the nearby links.
 *
 * **Server modules only.** It reads `API_GATEWAY_URL`.
 */
const compute = cache(
  async (city: string, state: string, type: 'sale' | 'rent'): Promise<ZipGroup[] | null> => {
    try {
      const clientIp = clientIpOf(await headers());
      const query = buildListingsQuery(
        toSearchParams({
          city,
          state,
          listingType: type,
          status: ['Active'],
          minCount: 1,
          limit: GROUP_PAGE_SIZE,
          offset: 0,
          order: 'count',
        } as never),
        FORWARDABLE_GROUPS_PARAMS,
      );
      const response = await proxyListingsRead('/zips', query, { cache: true, clientIp });
      if (!response.ok) return null;
      const parsed = zipsResponseSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? parsed.data.groups : null;
    } catch {
      return null;
    }
  },
);

export function loadCityZips(
  city: string,
  state: string,
  type: 'sale' | 'rent',
): Promise<ZipGroup[] | null> {
  return compute(city, state, type);
}
