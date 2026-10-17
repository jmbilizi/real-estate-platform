import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { authCookies, deviceCookie } from '@/app/api/_lib/cookies';
import { deviceHeaders } from '@/app/api/_lib/device';
import { badRequest, relay, unavailable, visitorIpHeaders } from '@/app/api/_lib/account-relay';

/**
 * Second step of a sign-in from a new device (#818). The account checks the password again with
 * the emailed code. On success this sets the session cookies and the device cookie.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  // The password is never trimmed: the server checks exactly what the user typed.
  const password = typeof body?.password === 'string' ? body.password : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const remember = body?.remember === true;
  if (!email || !password || !code) return badRequest();

  const upstream = await fetchGateway(
    '/account/login/device',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...visitorIpHeaders(req),
        ...deviceHeaders(req),
      },
      body: JSON.stringify({ email, password, code }),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    // Log the failure only. The payload holds a password and a code.
    console.error('Gateway device sign-in failed', err instanceof Error ? err.message : 'unknown');
    return null;
  });
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);

  const data = await upstream.json().catch(() => ({}));
  const res = NextResponse.json({
    email,
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
  });
  for (const c of authCookies(data, email, remember)) res.cookies.set(c.name, c.value, c.opts);
  const device = deviceCookie(upstream);
  if (device) res.cookies.set(device.name, device.value, device.opts);
  return res;
}
