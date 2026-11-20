import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { authCookies } from '@/app/api/_lib/cookies';
import { relay, unavailable, visitorIpHeaders } from '@/app/api/_lib/account-relay';

/**
 * Signs in, or signs up, with a Google ID token (#1049). account-service checks the token and
 * answers with a bearer session, as `/account/login` does. This route then sets the same cookies.
 * The bearer answer carries no address, so one `manage/info` call reads it for the session cookie.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const credential = typeof body?.credential === 'string' ? body.credential.trim() : '';
  const remember = body?.remember === true;
  if (!credential) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const upstream = await fetchGateway(
    '/account/login/google',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...visitorIpHeaders(req),
      },
      body: JSON.stringify({ credential }),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    // Log the failure only. The payload holds the token.
    console.error('Gateway Google sign-in failed', err instanceof Error ? err.message : 'unknown');
    return null;
  });
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);

  const data = await upstream.json().catch(() => null);
  if (!data?.accessToken) return unavailable();

  const info = await fetchGateway('/account/manage/info', {
    method: 'GET',
    headers: { Authorization: `Bearer ${data.accessToken}`, Accept: 'application/json' },
  }).catch(() => null);
  const profile = info?.ok ? await info.json().catch(() => null) : null;
  const email = typeof profile?.email === 'string' ? profile.email : '';
  if (!email) return unavailable();

  const res = NextResponse.json({
    email,
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
  });
  for (const c of authCookies(data, email, remember)) res.cookies.set(c.name, c.value, c.opts);
  return res;
}
