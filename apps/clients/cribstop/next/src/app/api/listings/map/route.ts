import { NextRequest } from 'next/server';
import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery, FORWARDABLE_MAP_PARAMS } from '@/app/api/_lib/listings-query';

/** Map pins or clusters for the viewport (#377). The same allowlist rules as `/api/listings`. */
export async function GET(req: NextRequest) {
  return proxyListingsRead(
    '/map',
    buildListingsQuery(req.nextUrl.searchParams, FORWARDABLE_MAP_PARAMS),
  );
}
