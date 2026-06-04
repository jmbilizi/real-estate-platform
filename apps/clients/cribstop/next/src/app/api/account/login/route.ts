import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { authCookies } from '@/app/api/_lib/cookies';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const upstream = await fetchGateway('/account/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch((err: unknown) => {
    console.error('Gateway login failed', err);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Sign-in service unavailable' }, { status: 503 });
  }

  if (!upstream.ok) {
    if (upstream.status === 401) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Sign-in failed' }, { status: upstream.status });
  }

  const data = await upstream.json().catch(() => ({}));

  // Build response and set auth cookies
  const res = NextResponse.json({
    email,
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
  });

  for (const c of authCookies(data, email)) {
    res.cookies.set(c.name, c.value, c.opts);
  }

  return res;
}
