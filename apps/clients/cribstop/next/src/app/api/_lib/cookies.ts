import { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

/** Default cookie options — HttpOnly, Secure, SameSite=Lax, path=/ */
function baseCookieOpts(maxAge: number): Partial<ResponseCookie> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/** Cookie names used for auth session. */
export const AUTH_COOKIES = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token',
  session: 'session',
} as const;

/**
 * Build Set-Cookie headers for a successful login.
 * @param tokens  Token payload from the Identity API
 * @param email   User email for the lightweight session cookie
 */
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function authCookies(
  tokens: { accessToken: string; refreshToken?: string; expiresIn?: number },
  email: string,
  remember = false,
): Array<{ name: string; value: string; opts: Partial<ResponseCookie> }> {
  // Without remember me: session cookie (expires when browser closes).
  // With remember me: persist for 30 days.
  const maxAge = remember ? REMEMBER_ME_MAX_AGE : (tokens.expiresIn ?? 3600);

  const cookies: Array<{ name: string; value: string; opts: Partial<ResponseCookie> }> = [
    {
      name: AUTH_COOKIES.accessToken,
      value: tokens.accessToken,
      opts: baseCookieOpts(maxAge),
    },
    {
      name: AUTH_COOKIES.session,
      value: JSON.stringify({ email }),
      opts: { ...baseCookieOpts(maxAge), httpOnly: false }, // readable by client for display
    },
  ];

  if (tokens.refreshToken) {
    cookies.push({
      name: AUTH_COOKIES.refreshToken,
      value: tokens.refreshToken,
      opts: baseCookieOpts(maxAge * 4), // refresh token lives longer
    });
  }

  return cookies;
}

/** Build Set-Cookie headers that expire (clear) all auth cookies. */
export function clearAuthCookies(): Array<{
  name: string;
  value: string;
  opts: Partial<ResponseCookie>;
}> {
  return Object.values(AUTH_COOKIES).map((name) => ({
    name,
    value: '',
    opts: { ...baseCookieOpts(0), httpOnly: false },
  }));
}
