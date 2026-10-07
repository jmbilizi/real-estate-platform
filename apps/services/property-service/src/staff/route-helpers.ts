import type { NextFunction, Request, Response } from 'express';
import type { ErrorBody } from '@cribstop/property-contracts';
import { ROLE } from './roles';

export const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/** Names only, filtered: a field name is caller input and must not be reflected raw. */
export function describeIssues(
  issues: readonly { code: string; path: readonly PropertyKey[]; keys?: readonly string[] }[],
): string {
  const names = new Set<string>();
  for (const issue of issues) {
    const raw =
      issue.code === 'unrecognized_keys'
        ? (issue.keys ?? [])
        : [String(issue.path[0] ?? '(request)')];
    for (const name of raw) {
      const trimmed = name.slice(0, 40);
      names.add(/^[A-Za-z0-9_.()-]+$/.test(trimmed) ? trimmed : '(unnamed)');
    }
  }
  return `Invalid or unknown field(s): ${[...names].join(', ')}.`;
}

/** The role the actor acts under, named in the audit rows. The highest staff role held. */
export function actingRole(roles: readonly string[]): string {
  for (const role of [ROLE.SuperAdmin, ROLE.Admin, ROLE.Moderator]) {
    if (roles.includes(role)) return role;
  }
  return ROLE.Moderator;
}
