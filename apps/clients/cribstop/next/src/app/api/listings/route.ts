import { NextRequest } from 'next/server';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery } from '@/app/api/_lib/listings-query';

export async function GET(req: NextRequest) {
  return proxyListingsRead('', buildListingsQuery(req.nextUrl.searchParams), {
    // Only a short list that never pages (`skipTotal`, the home page rows) shares one stored read.
    // A search page has too many query shapes to gain from it.
    cache: req.nextUrl.searchParams.get('skipTotal') === 'true',
    clientIp: clientIpOf(req.headers),
  });
}
