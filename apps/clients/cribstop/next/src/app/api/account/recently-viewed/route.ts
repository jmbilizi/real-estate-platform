import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Records one listing view for the signed-in account (#982). Only `listingId` is forwarded. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = body?.listingId;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
  }

  const upstream = await fetchGatewayAsUser(req, '/account/recently-viewed', {
    method: 'POST',
    body: { listingId: id },
  });
  return new NextResponse(null, { status: upstream.ok ? 204 : upstream.status, headers: NO_STORE });
}
