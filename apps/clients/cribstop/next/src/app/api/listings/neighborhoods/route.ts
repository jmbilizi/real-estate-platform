import { NextRequest } from 'next/server';
import { clientIpOf, proxyListingsQuery } from '@/app/api/_lib/listings-gateway';
import {
  buildListingsQuery,
  FORWARDABLE_NEIGHBORHOODS_PARAMS,
  SEARCH_ONLY_PARAMS,
} from '@/app/api/_lib/listings-query';

/** Neighborhood counts for the home page's "Explore neighborhoods" row (#390, #393). */
export async function GET(req: NextRequest) {
  return proxyListingsQuery(
    '/neighborhoods',
    () =>
      buildListingsQuery(
        req.nextUrl.searchParams,
        FORWARDABLE_NEIGHBORHOODS_PARAMS,
        SEARCH_ONLY_PARAMS,
      ),
    { cache: true, clientIp: clientIpOf(req.headers) },
  );
}
