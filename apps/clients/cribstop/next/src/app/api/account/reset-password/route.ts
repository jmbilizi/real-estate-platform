import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const resetCode = typeof body?.resetCode === 'string' ? body.resetCode : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!email || !resetCode || !newPassword) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const upstream = await fetchGateway(
    '/account/resetPassword',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, resetCode, newPassword }),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    console.error('Gateway reset-password failed', err);
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
    return NextResponse.json(
      { error: classifyFailure(await upstream.json().catch(() => null)) },
      {
        status: upstream.status,
      },
    );
  }

  return NextResponse.json({ success: true });
}

/**
 * Sorts an Identity failure body into `invalid` (unusable code, unknown address, or unconfirmed
 * address — all reported the same way on purpose) or `policy` (the new password itself failed
 * validation). Anything else falls back to a generic failure.
 */
function classifyFailure(body: unknown): 'invalid' | 'policy' | 'failed' {
  const errors =
    body && typeof body === 'object' && 'errors' in body
      ? (body as { errors?: Record<string, unknown> }).errors
      : null;
  const codes = errors ? Object.keys(errors) : [];

  if (codes.includes('InvalidToken')) return 'invalid';
  if (codes.some((code) => code.startsWith('Password'))) return 'policy';
  return 'failed';
}
