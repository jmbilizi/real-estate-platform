import { NextRequest } from 'next/server';
import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';
import { buildListingsQuery } from '@/app/api/_lib/listings-query';

export async function GET(req: NextRequest) {
  return proxyListingsRead('', buildListingsQuery(req.nextUrl.searchParams));
}
