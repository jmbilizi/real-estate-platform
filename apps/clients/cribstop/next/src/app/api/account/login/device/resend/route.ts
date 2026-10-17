import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { deviceHeaders, deviceTiming } from '@/app/api/_lib/device';
import { badRequest, relay, unavailable, visitorIpHeaders } from '@/app/api/_lib/account-relay';

/** Sends a new device code. The password gates the send, so a stranger cannot mail an owner. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) return badRequest();

  const upstream = await fetchGateway(
    '/account/login/device/resend',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...visitorIpHeaders(req),
        ...deviceHeaders(req),
      },
      body: JSON.stringify({ email, password }),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    console.error('Gateway device resend failed', err instanceof Error ? err.message : 'unknown');
    return null;
  });
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);
  return NextResponse.json(deviceTiming(await upstream.json().catch(() => null)));
}
