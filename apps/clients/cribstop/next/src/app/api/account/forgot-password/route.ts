import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const upstream = await fetchGateway(
    '/account/forgotPassword',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email }),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    console.error('Gateway forgot-password failed', err);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  if (upstream.status === 429) {
    const res = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.headers.set('Retry-After', retryAfter);
    return res;
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'failed' }, { status: upstream.status });
  }

  // Identity answers 200 for every address, registered or not (#147's non-enumeration guarantee).
  // Forward that as-is. Never translate this into "account found" or "no account found".
  return NextResponse.json({ success: true });
}
