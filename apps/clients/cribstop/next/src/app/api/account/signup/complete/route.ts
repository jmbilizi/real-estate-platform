import { NextResponse } from 'next/server';
import { authCookies } from '@/app/api/_lib/cookies';
import {
  badRequest,
  callGateway,
  relay,
  stringField,
  unavailable,
} from '@/app/api/_lib/account-relay';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = stringField(body, 'email');
  const signupProof = stringField(body, 'signupProof');
  // The password is never trimmed: the server hashes exactly what the user typed.
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !signupProof || !password) return badRequest();

  // No useCookies query: the session comes back as a bearer body, as /account/login does.
  const upstream = await callGateway(
    '/account/signup/complete',
    { email, signupProof, password },
    'signup complete',
  );
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);

  const data = await upstream.json().catch(() => ({}));
  if (!data?.accessToken) return NextResponse.json({ error: 'failed' }, { status: 502 });

  const res = NextResponse.json({
    email,
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
  });
  for (const c of authCookies(data, email, false)) {
    res.cookies.set(c.name, c.value, c.opts);
  }
  return res;
}
