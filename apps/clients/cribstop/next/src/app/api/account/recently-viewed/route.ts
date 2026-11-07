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

/** Lists the listing ids the signed-in account viewed, newest first (#366). */
export async function GET(req: NextRequest) {
  const upstream = await fetchGatewayAsUser(req, '/account/recently-viewed', { method: 'GET' });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'Failed to load recently viewed' },
      { status: upstream.status, headers: NO_STORE },
    );
  }
  const body = await upstream.json().catch(() => null);
  const ids: unknown[] = Array.isArray(body?.listingIds) ? body.listingIds : [];
  return NextResponse.json(
    { listingIds: ids.filter((id): id is string => typeof id === 'string') },
    { headers: NO_STORE },
  );
}
