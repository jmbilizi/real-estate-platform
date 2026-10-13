import { headers } from 'next/headers';
import { type ListingsEnvelope, PAGE_SIZE_DEFAULT } from '@cribstop/property-contracts';
import { buildListingsQuery } from '@/app/api/_lib/listings-query';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { parseGroupState } from '@/lib/group-by';
import { parsePageFromSearchParams } from '@/lib/listing-filters';
import { parseQueryFilters } from '@/lib/search-place';
import type { SearchFilters } from '@/lib/types';
import { toSearchParams } from './listings';

/**
 * The first page of a search path, fetched on the server (#841), so the first HTML holds the
 * listing cards. It makes the call the browser makes through `/api/listings`: the same allowlist,
 * the same gateway, the same masking and suppression rules.
 *
 * Returns `undefined` on any failure or for a grouped view. The client then fetches as before.
 *
 * **Server modules only.** It reads `API_GATEWAY_URL`.
 */
export async function loadInitialResults(
  initialQuery: string,
  place: { readonly filters: SearchFilters },
): Promise<ListingsEnvelope | undefined> {
  const params = new URLSearchParams(initialQuery);
  if (parseGroupState(params).groupBy) return undefined;

  const request = {
    ...parseQueryFilters(params, place),
    ...place.filters,
    page: parsePageFromSearchParams(params),
    pageSize: PAGE_SIZE_DEFAULT,
  };
  try {
    const clientIp = clientIpOf(await headers());
    const response = await proxyListingsRead('', buildListingsQuery(toSearchParams(request)), {
      clientIp,
    });
    if (!response.ok) return undefined;
    return (await response.json()) as ListingsEnvelope;
  } catch {
    return undefined;
  }
}
