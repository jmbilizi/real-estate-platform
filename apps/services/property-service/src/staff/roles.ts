import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  FORBIDDEN_BODY,
  SIGN_IN_REQUIRED_BODY,
  UNAVAILABLE_BODY,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import { authenticate, PRIVATE_CACHE_CONTROL } from '../saved/identity';

/** Role names, as account-service spells them (`Models/Roles.cs`). */
export const ROLE = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Admin',
  Moderator: 'Moderator',
  Support: 'Support',
  Developer: 'Developer',
  Agent: 'Agent',
  User: 'User',
} as const;

export type RoleName = (typeof ROLE)[keyof typeof ROLE];

/** The caller a passed guard resolved. `requireRole` stores it in `res.locals.staff`. */
export interface StaffCaller {
  accountId: string;
  roles: readonly string[];
}

/** `SuperAdmin` counts as `Admin`: it passes any check that allows `Admin`. */
export function hasAnyRole(held: readonly string[], allowed: readonly string[]): boolean {
  const effective = new Set(held);
  if (effective.has(ROLE.SuperAdmin)) effective.add(ROLE.Admin);
  return allowed.some((role) => effective.has(role));
}

/** The caller a passed `requireRole` stored. Throws if the guard did not run. */
export function staffCallerOf(res: Response): StaffCaller {
  const caller = (res.locals as { staff?: StaffCaller }).staff;
  if (caller === undefined) throw new Error('requireRole did not run before this handler.');
  return caller;
}

/**
 * Guard for the staff and agent APIs (#628). Allows the request when the caller holds ANY of
 * `allowed`. Never an equals check: accounts are multi-role (PRD §11.2).
 *
 * - 401: no valid credential.
 * - 503: account-service did not answer. The session is unknown, so a client may retry.
 * - 403: a valid credential with no allowed role.
 *
 * Introspection runs once per request and is never cached, so a revoked session or a removed role
 * stops working at once.
 */
export function requireRole(
  introspection: IntrospectionClient,
  ...allowed: readonly RoleName[]
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    authenticate(introspection, req)
      .then((outcome) => {
        if (outcome.kind === 'unavailable') {
          res.set('Retry-After', '2').status(503).json(UNAVAILABLE_BODY);
        } else if (outcome.kind !== 'account') {
          res.status(401).json(SIGN_IN_REQUIRED_BODY);
        } else if (!hasAnyRole(outcome.roles, allowed)) {
          res.status(403).json(FORBIDDEN_BODY);
        } else {
          const caller: StaffCaller = { accountId: outcome.accountId, roles: outcome.roles };
          (res.locals as { staff?: StaffCaller }).staff = caller;
          next();
        }
      })
      .catch(next);
  };
}
