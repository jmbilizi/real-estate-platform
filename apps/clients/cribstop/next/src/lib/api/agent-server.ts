import { cookies } from 'next/headers';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { AUTH_COOKIES } from '@/app/api/_lib/cookies';
import { loadStaffGate } from './staff-server';

export interface AgentGate {
  /** The caller holds the Agent role AND an active agent profile. */
  allowed: boolean;
  /** Same meaning as `StaffGate.canRefresh`. */
  canRefresh: boolean;
}

/**
 * Server-side gate of the agent area. The role comes from `GET /property/staff/me`. The active
 * profile has no read of its own, so a role holder is checked with one cheap call to the agent API.
 * That API answers 403 without an active profile. Any failure closes the gate. The service
 * enforces both conditions on every agent call, so this is a courtesy gate.
 *
 * **Server modules only.**
 */
export async function loadAgentGate(): Promise<AgentGate> {
  const staff = await loadStaffGate();
  if (!staff.roles.includes('Agent')) return { allowed: false, canRefresh: staff.canRefresh };

  const token = (await cookies()).get(AUTH_COOKIES.accessToken)?.value;
  if (!token) return { allowed: false, canRefresh: false };
  const probe = await fetchGateway('/property/agent/leads?status=lost', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  return { allowed: probe?.ok === true, canRefresh: false };
}
