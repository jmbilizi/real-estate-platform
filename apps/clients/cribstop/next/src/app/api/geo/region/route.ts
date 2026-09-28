import { NextRequest, NextResponse } from 'next/server';
import { fetchRegion } from '@/app/api/_lib/geo-region';

/**
 * The home page's "near you" personalization region (#363), from the gateway's IP lookup (#362).
 * Always resolves — never a non-2xx status — so the client's own `null` case is "no region",
 * never "the request failed": there is no error UI, no browser geolocation prompt, no fallback
 * city.
 */
export async function GET(req: NextRequest) {
  const region = await fetchRegion(req.headers.get('x-real-ip'));
  return NextResponse.json(region);
}
