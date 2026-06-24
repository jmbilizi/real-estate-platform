import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const upstream = await fetchGateway(
    '/account/register',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    console.error('Gateway signup failed', err);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Sign-up service unavailable' }, { status: 503 });
  }

  if (!upstream.ok) {
    const errBody = await upstream.json().catch(() => null);
    const detail = firstValidationError(errBody);
    return NextResponse.json(
      { error: detail ?? 'Sign-up failed. Please verify your details.' },
      { status: upstream.status },
    );
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

function firstValidationError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const errors = (body as Record<string, unknown>).errors;
  if (!errors || typeof errors !== 'object') return null;
  const messages = Object.values(errors as Record<string, string[]>).flat();
  return messages.length > 0 ? messages[0] : null;
}
