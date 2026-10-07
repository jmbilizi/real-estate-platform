import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  FORBIDDEN_BODY,
  idSchema,
  INVALID_TRANSITION_BODY,
  LEAD_NOT_FOUND_BODY,
  type LeadStatus,
  MODERATOR_TARGET_STATUSES,
  STAFF_LEADS_PAGE_SIZE_DEFAULT,
  STAFF_NOTE_REQUIRED_STATUSES,
  staffLeadNoteRequestSchema,
  staffLeadsRequestSchema,
  staffLeadTransitionRequestSchema,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import { changeLeadStatus, type TransactionalPool } from '../inquiries/lead-status-write';
import type { Queryable } from '../inquiries/write';
import { addLeadNote, decodeCursor, encodeCursor, listLeads, readLeadDetail } from './leads-store';
import { hasAnyRole, requireRole, ROLE, staffCallerOf } from './roles';

export interface StaffLeadsRouterDeps {
  pool: Queryable & TransactionalPool;
  introspection: IntrospectionClient;
}

/** The roles that run the lead desk. `SuperAdmin` passes through `Admin` (see `hasAnyRole`). */
const LEAD_DESK_ROLES = [ROLE.Admin, ROLE.Moderator] as const;

const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/** Names only, filtered: a field name is caller input and must not be reflected raw. */
function describeIssues(
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
function actingRole(roles: readonly string[]): string {
  for (const role of [ROLE.SuperAdmin, ROLE.Admin, ROLE.Moderator]) {
    if (roles.includes(role)) return role;
  }
  return ROLE.Moderator;
}

/** What the caller may set. A Moderator sets `verified`, `spam` and `rejected` only. */
function mayTransitionTo(roles: readonly string[], to: LeadStatus): boolean {
  if ((MODERATOR_TARGET_STATUSES as readonly string[]).includes(to)) return true;
  // Restoring a spam lead to `new` undoes a wrong call. Admin only.
  return to === 'new' && hasAnyRole(roles, [ROLE.Admin]);
}

/**
 * The staff lead desk (#632): list, detail, transition and notes. Every route runs behind
 * `requireRole`, so the 401, 503 and 403 cases never reach a handler. Every response is
 * `private, no-store`, which the guard sets before it answers.
 */
export function createStaffLeadsRouter(deps: StaffLeadsRouterDeps): Router {
  const router = Router();
  const guard = requireRole(deps.introspection, ...LEAD_DESK_ROLES);

  router.get(
    '/staff/leads',
    guard,
    asyncRoute(async (req, res) => {
      const parsed = staffLeadsRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(invalidRequest(describeIssues(parsed.error.issues)));
        return;
      }
      const { limit, cursor: rawCursor, ...filters } = parsed.data;
      const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
      if (rawCursor !== undefined && cursor === null) {
        res.status(400).json(invalidRequest('Invalid or unknown field(s): cursor.'));
        return;
      }
      const page = await listLeads(deps.pool, {
        filters,
        limit: limit ?? STAFF_LEADS_PAGE_SIZE_DEFAULT,
        cursor,
      });
      res
        .status(200)
        .json({ results: page.results, nextCursor: page.next ? encodeCursor(page.next) : null });
    }),
  );

  router.get(
    '/staff/leads/:id',
    guard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      const caller = staffCallerOf(res);
      const detail = await readLeadDetail(deps.pool, id.data, {
        accountId: caller.accountId,
        role: actingRole(caller.roles),
      });
      if (detail === null) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      res.status(200).json(detail);
    }),
  );

  router.post(
    '/staff/leads/:id/transition',
    guard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      const body = staffLeadTransitionRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      const caller = staffCallerOf(res);
      if (!mayTransitionTo(caller.roles, body.data.to)) {
        res.status(403).json(FORBIDDEN_BODY);
        return;
      }
      if (
        (STAFF_NOTE_REQUIRED_STATUSES as readonly string[]).includes(body.data.to) &&
        body.data.note === undefined
      ) {
        res.status(400).json(invalidRequest('A note is required for this status.'));
        return;
      }
      const result = await changeLeadStatus(deps.pool, {
        leadId: id.data,
        to: body.data.to,
        actorAccountId: caller.accountId,
        actorRole: actingRole(caller.roles),
        note: body.data.note ?? null,
      });
      if (!result.ok) {
        if (result.reason === 'not_found') res.status(404).json(LEAD_NOT_FOUND_BODY);
        else res.status(409).json(INVALID_TRANSITION_BODY);
        return;
      }
      res.status(200).json({ id: id.data, from: result.from, to: result.to });
    }),
  );

  router.post(
    '/staff/leads/:id/notes',
    guard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      const body = staffLeadNoteRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      const caller = staffCallerOf(res);
      const note = await addLeadNote(deps.pool, {
        leadId: id.data,
        body: body.data.body,
        authorAccountId: caller.accountId,
        authorRole: actingRole(caller.roles),
      });
      if (note === null) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      res.status(201).json(note);
    }),
  );

  return router;
}
