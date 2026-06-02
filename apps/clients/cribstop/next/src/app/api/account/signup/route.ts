import { NextResponse } from 'next/server';
import { fetchGateway, resolveGatewayUrl } from '@/app/api/account/_lib/gateway';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !email || !password) {
    return NextResponse.json(
      { error: 'Username, email, and password are required' },
      { status: 400 },
    );
  }

  let gatewayUrl = '';
  try {
    gatewayUrl = resolveGatewayUrl();
  } catch {
    return NextResponse.json({ error: 'Gateway is not configured' }, { status: 500 });
  }

  const upstream = await fetchGateway(`${gatewayUrl}/account/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userName: username, email, password }),
  }).catch((error) => {
    console.error('Gateway signup request failed', error);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Sign up service unavailable' }, { status: 503 });
  }

  if (!upstream.ok) {
    if (upstream.status === 400) {
      return NextResponse.json(
        { error: 'Sign up failed. Please verify your details.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Sign up failed' }, { status: upstream.status });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
