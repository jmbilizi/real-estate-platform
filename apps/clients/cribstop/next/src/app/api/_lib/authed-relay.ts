import { NextRequest, NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { AUTH_COOKIES, authCookies } from '@/app/api/_lib/cookies';
import { tryRefreshToken } from '@/app/api/_lib/refresh';

function post(path: string, token: string, payload: unknown) {
  return fetchGateway(
    path,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  );
}

/**
 * POSTs to the gateway as the signed-in caller. An expired token is refreshed once. Returns
 * `null` when the gateway is unreachable. No access token gives a 401.
 */
export async function postAuthed(
  req: NextRequest,
  path: string,
  payload: unknown,
  label: string,
): Promise<Response | null> {
  const token = req.cookies.get(AUTH_COOKIES.accessToken)?.value;
  if (!token) return new Response(null, { status: 401 });
  const attempt = (t: string) =>
    post(path, t, payload).catch((err: unknown) => {
      // Log the failure only. The payload holds a password or a code.
      console.error(`Gateway ${label} failed`, err instanceof Error ? err.message : 'unknown');
      return null;
    });
  let upstream = await attempt(token);
  if (upstream?.status === 401) {
    const fresh = await tryRefreshToken();
    if (fresh) upstream = await attempt(fresh);
  }
  return upstream;
}

/** The session email cookie, which the client reads for display. */
export function sessionEmail(req: NextRequest): string {
  try {
    const raw = req.cookies.get(AUTH_COOKIES.session)?.value;
    const email = raw ? (JSON.parse(raw) as { email?: unknown }).email : '';
    return typeof email === 'string' ? email : '';
  } catch {
    return '';
  }
}

async function currentEmail(token: string, fallback: string): Promise<string> {
  const res = await fetchGateway('/account/manage/info', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  return typeof body?.email === 'string' && body.email ? body.email : fallback;
}

/**
 * Turns the re-issued bearer session of a successful change into the auth cookies. The change
 * ended the old tokens, so a body with no access token is a failure. An email change reads the
 * new address from the account, or from `hint` when that read fails. A password change keeps the
 * address. The cookies persist, as the token refresh makes them.
 */
export async function reissueSession(
  req: NextRequest,
  upstream: Response,
  readEmail: boolean,
  hint = '',
): Promise<NextResponse> {
  const data = await upstream.json().catch(() => null);
  if (!data?.accessToken) return NextResponse.json({ error: 'failed' }, { status: 502 });
  const fallback = readEmail ? hint || sessionEmail(req) : sessionEmail(req);
  const email = readEmail ? await currentEmail(data.accessToken, fallback) : fallback;
  const res = NextResponse.json({
    email,
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
  });
  for (const c of authCookies(data, email, true)) res.cookies.set(c.name, c.value, c.opts);
  return res;
}
