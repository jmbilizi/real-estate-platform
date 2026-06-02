import { NextResponse } from 'next/server';

const gatewayUrl = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:8080'
).replace(/\/$/, '');

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const upstream = await fetch(`${gatewayUrl}/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!upstream.ok) {
    if (upstream.status === 401) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Sign in failed' }, { status: upstream.status });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
