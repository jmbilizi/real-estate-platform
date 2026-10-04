import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

export async function GET(req: NextRequest) {
  const upstream = await fetchGatewayAsUser(req, '/account/waitlist', { method: 'GET' });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to load waitlist' }, { status: upstream.status });
  }
  return NextResponse.json(await upstream.json().catch(() => ({ interests: [] })));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.interest !== 'string') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Forward only the interest kind, never the caller's other fields.
  const upstream = await fetchGatewayAsUser(req, '/account/waitlist', {
    method: 'POST',
    body: { interest: body.interest },
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: upstream.status });
  }
  return new NextResponse(null, { status: 204 });
}
