import { NextRequest } from 'next/server';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';

/**
 * Dataset freshness, deliberately independent of any search: the footer renders on every route,
 * including routes that never search, so it cannot be fed from a paginated search response.
 */
export async function GET(req: NextRequest) {
  return proxyListingsRead('/meta', '', { cache: true, clientIp: clientIpOf(req.headers) });
}
