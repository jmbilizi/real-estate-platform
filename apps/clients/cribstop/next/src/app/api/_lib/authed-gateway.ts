import { NextRequest, NextResponse } from 'next/server';
import { fetchGateway } from './gateway';
import { AUTH_COOKIES } from './cookies';
import { tryRefreshToken } from './refresh';

/**
 * Calls a gateway path as the signed-in user. Retries once with a refreshed token after a 401.
 * Returns a ready 401 response when the request has no access token, and 503 when the gateway
 * does not answer.
 */
export async function fetchGatewayAsUser(
  req: NextRequest,
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  // The access cookie can expire before the refresh cookie does, so a missing one still tries a refresh.
  const accessToken = req.cookies.get(AUTH_COOKIES.accessToken)?.value ?? (await tryRefreshToken());
  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const call = (token: string) =>
    fetchGateway(path, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }).catch(() => null);

  let upstream = await call(accessToken);
  if (upstream?.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) upstream = await call(newToken);
  }

  return upstream ?? NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
}
