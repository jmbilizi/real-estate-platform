import { cookies } from 'next/headers';
import { fetchGateway } from './gateway';
import { AUTH_COOKIES, authCookies } from './cookies';

interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Attempt to refresh an expired access token using the stored refresh_token cookie.
 * On success, updates cookies in-place and returns the new access token.
 * On failure (no refresh token, expired refresh token), returns null.
 */
export async function tryRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(AUTH_COOKIES.refreshToken)?.value;
  if (!refreshToken) return null;

  const res = await fetchGateway('/account/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => null);

  if (!res || !res.ok) return null;

  const data = (await res.json().catch(() => null)) as RefreshResult | null;
  if (!data?.accessToken) return null;

  // Update cookies with new tokens
  const email = cookieStore.get(AUTH_COOKIES.session)?.value;
  let sessionEmail = '';
  try {
    if (email) sessionEmail = (JSON.parse(email) as { email?: string }).email ?? '';
  } catch {}

  const newCookies = authCookies(
    { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn },
    sessionEmail,
    true,
  );

  for (const c of newCookies) {
    cookieStore.set(c.name, c.value, c.opts);
  }

  return data.accessToken;
}
