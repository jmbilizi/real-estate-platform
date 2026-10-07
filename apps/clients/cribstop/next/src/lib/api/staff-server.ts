import { cookies } from 'next/headers';
import { staffMeSchema } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { AUTH_COOKIES } from '@/app/api/_lib/cookies';

/** Set by the refresh route for a few seconds. It stops a refresh loop when the token stays bad. */
export const STAFF_REFRESH_COOKIE = 'staff_refresh_try';

export interface StaffGate {
  roles: string[];
  /** The session token is missing or expired, and a refresh token exists. A refresh may fix it. */
  canRefresh: boolean;
}

/**
 * Server-side role lookup for the staff area, from `GET /property/staff/me`.
 *
 * Returns the caller's roles, or an empty list on any failure: no session, an expired token, a
 * gateway error, a malformed body. An empty list closes the gate, so a fault never opens it.
 * This is a courtesy gate. The service enforces the roles on every staff call.
 *
 * A server component cannot set cookies, so it cannot refresh an expired access token itself.
 * `canRefresh` tells the layout to send the browser through `/api/staff/refresh` once.
 *
 * **Server modules only.** It reads the session cookie and the gateway address.
 */
export async function loadStaffGate(): Promise<StaffGate> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIES.accessToken)?.value;
  const hasRefresh = Boolean(jar.get(AUTH_COOKIES.refreshToken)?.value);
  const retried = jar.has(STAFF_REFRESH_COOKIE);
  const closed = (expired: boolean): StaffGate => ({
    roles: [],
    canRefresh: expired && hasRefresh && !retried,
  });

  if (!token) return closed(true);

  const upstream = await fetchGateway('/property/staff/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  if (!upstream) return closed(false);
  if (upstream.status === 401) return closed(true);
  if (!upstream.ok) return closed(false);

  const parsed = staffMeSchema.safeParse(await upstream.json().catch(() => null));
  return parsed.success ? { roles: parsed.data.roles, canRefresh: false } : closed(false);
}
