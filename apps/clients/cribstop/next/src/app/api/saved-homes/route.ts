import { NextRequest } from 'next/server';
import { relaySaved } from '@/app/api/_lib/saved-gateway';

/** Lists the account's saved homes (#23). Only `page` and `pageSize` pass. The service rejects any other key. */
export async function GET(req: NextRequest) {
  const params = new URLSearchParams();
  for (const key of ['page', 'pageSize']) {
    const value = req.nextUrl.searchParams.get(key);
    if (value !== null) params.set(key, value);
  }
  const query = params.toString();
  return relaySaved(req, `/property/saved-homes${query ? `?${query}` : ''}`, 'GET');
}
