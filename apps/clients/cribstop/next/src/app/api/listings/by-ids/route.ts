import { NextRequest } from 'next/server';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery, FORWARDABLE_BY_IDS_PARAMS } from '@/app/api/_lib/listings-query';

/**
 * Card rows for a set of listing ids (#76), at most 50. The id set is in the query string. The
 * id set is one visitor's saved list, so the shared read cache does not hold the answer.
 */
export async function GET(req: NextRequest) {
  return proxyListingsRead(
    '/by-ids',
    buildListingsQuery(req.nextUrl.searchParams, FORWARDABLE_BY_IDS_PARAMS),
    { clientIp: clientIpOf(req.headers) },
  );
}
