import { NextResponse } from 'next/server';

const gatewayUrl = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  'http://localhost:8080'
).replace(/\/$/, '');

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !email || !password) {
    return NextResponse.json(
      { error: 'UserName, email, and password are required' },
      { status: 400 },
    );
  }

  const upstream = await fetch(`${gatewayUrl}/account/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userName: username, email, password }),
  });

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
