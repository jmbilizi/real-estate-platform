import { NextRequest } from 'next/server';
import { proxyListingsQuery } from '@/app/api/_lib/listings-gateway';
import {
  buildListingsQuery,
  FORWARDABLE_GROUPS_PARAMS,
  SEARCH_ONLY_PARAMS,
} from '@/app/api/_lib/listings-query';

/** ZIP code groups for the results "Group by" control (#722). */
export async function GET(req: NextRequest) {
  return proxyListingsQuery('/zips', () =>
    buildListingsQuery(req.nextUrl.searchParams, FORWARDABLE_GROUPS_PARAMS, SEARCH_ONLY_PARAMS),
  );
}
