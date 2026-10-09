import { NextRequest } from 'next/server';
import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery, FORWARDABLE_GROUPS_PARAMS } from '@/app/api/_lib/listings-query';

/** Listing office groups for the results "Group by" control (#722). */
export async function GET(req: NextRequest) {
  return proxyListingsRead(
    '/brokers',
    buildListingsQuery(req.nextUrl.searchParams, FORWARDABLE_GROUPS_PARAMS),
  );
}
