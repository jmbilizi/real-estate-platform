import type { CredentialHeaders } from '../inquiries/account-introspection';
import { ROLE } from './roles';

/**
 * Does an account hold the `Agent` role? Only account-service knows (#634). It answers
 * `GET /account/{id}/roles` for an Admin or SuperAdmin caller, so the check forwards the
 * credentials of the staff member who creates or reactivates the profile. A Moderator cannot ask,
 * so the assign route does not re-check: it trusts the profile and its `active` flag.
 */
export type AgentRoleOutcome = 'has-role' | 'no-role' | 'unavailable';

export interface AgentRoleChecker {
  check(accountId: string, credentials: CredentialHeaders): Promise<AgentRoleOutcome>;
}

export interface HttpAgentRoleCheckerOptions {
  /** account-service origin, for example `http://account-service-svc:8080`. */
  baseUrl: string;
  timeoutMs: number;
}

export function createHttpAgentRoleChecker(options: HttpAgentRoleCheckerOptions): AgentRoleChecker {
  return {
    async check(accountId, credentials) {
      try {
        const response = await fetch(
          `${options.baseUrl}/account/${encodeURIComponent(accountId)}/roles`,
          {
            headers: {
              ...(credentials.cookie ? { Cookie: credentials.cookie } : {}),
              ...(credentials.authorization ? { Authorization: credentials.authorization } : {}),
              ...(credentials.apiKey ? { 'X-Api-Key': credentials.apiKey } : {}),
            },
            signal: AbortSignal.timeout(options.timeoutMs),
          },
        );
        // An unknown or deleted account holds no role.
        if (response.status === 404) return 'no-role';
        if (!response.ok) return 'unavailable';
        const roles: unknown = await response.json();
        return Array.isArray(roles) && roles.includes(ROLE.Agent) ? 'has-role' : 'no-role';
      } catch (error) {
        console.warn('Agent role check failed.', error);
        return 'unavailable';
      }
    },
  };
}
