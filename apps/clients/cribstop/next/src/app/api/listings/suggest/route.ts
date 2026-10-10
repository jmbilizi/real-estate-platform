import { NextRequest } from 'next/server';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery, FORWARDABLE_SUGGEST_PARAMS } from '@/app/api/_lib/listings-query';

/**
 * Where suggestions from our own listings (#781). Cached in the web read cache: a prefix repeats
 * across visitors, and the cache keeps typing traffic off the gateway rate limit.
 */
export async function GET(req: NextRequest) {
  const params = new URLSearchParams(req.nextUrl.searchParams);
  // Case-insensitive match upstream, so one cache entry serves "Rock" and "rock".
  const q = params.get('q');
  if (q !== null) params.set('q', q.trim().toLowerCase());
  return proxyListingsRead('/suggest', buildListingsQuery(params, FORWARDABLE_SUGGEST_PARAMS), {
    cache: true,
    clientIp: clientIpOf(req.headers),
    store: 'suggest',
  });
}
