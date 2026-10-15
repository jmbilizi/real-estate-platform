import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

export async function GET(req: NextRequest) {
  const upstream = await fetchGatewayAsUser(req, '/property/looking-for', { method: 'GET' });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: upstream.status });
  }
  return NextResponse.json(await upstream.json().catch(() => ({ items: [], max: 5 })));
}
