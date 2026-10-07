import { cookies } from 'next/headers';
import { staffMeSchema } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { AUTH_COOKIES } from '@/app/api/_lib/cookies';

/**
 * Server-side role lookup for the staff area, from `GET /property/staff/me`.
 *
 * Returns the caller's roles, or an empty list on any failure: no session, an expired token, a
 * gateway error, a malformed body. An empty list closes the gate, so a fault never opens it.
 * This is a courtesy gate. The service enforces the roles on every staff call.
 *
 * **Server modules only.** It reads the session cookie and the gateway address.
 */
export async function loadStaffRoles(): Promise<string[]> {
  const token = (await cookies()).get(AUTH_COOKIES.accessToken)?.value;
  if (!token) return [];

  const upstream = await fetchGateway('/property/staff/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  if (!upstream?.ok) return [];

  const parsed = staffMeSchema.safeParse(await upstream.json().catch(() => null));
  return parsed.success ? parsed.data.roles : [];
}
