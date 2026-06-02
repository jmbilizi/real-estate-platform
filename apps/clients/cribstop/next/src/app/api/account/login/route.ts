import { NextResponse } from 'next/server';
import { fetchGateway, resolveGatewayUrl } from '@/app/api/account/_lib/gateway';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  let gatewayUrl = '';
  try {
    gatewayUrl = resolveGatewayUrl();
  } catch {
    return NextResponse.json({ error: 'Gateway is not configured' }, { status: 500 });
  }

  const upstream = await fetchGateway(`${gatewayUrl}/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch((error) => {
    console.error('Gateway login request failed', error);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Sign in service unavailable' }, { status: 503 });
  }

  if (!upstream.ok) {
    if (upstream.status === 401) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Sign in failed' }, { status: upstream.status });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
