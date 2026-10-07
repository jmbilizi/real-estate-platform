import { Router } from 'express';
import {
  AGENT_INACTIVE_BODY,
  AGENT_NOT_FOUND_BODY,
  AGENT_NOT_LICENSED_BODY,
  FORBIDDEN_BODY,
  idSchema,
  INVALID_TRANSITION_BODY,
  LEAD_NOT_ASSIGNED_BODY,
  LEAD_NOT_FOUND_BODY,
  type LeadStatus,
  MODERATOR_TARGET_STATUSES,
  STAFF_LEAD_AGING_HOURS_DEFAULT,
  STAFF_LEADS_PAGE_SIZE_DEFAULT,
  STAFF_NOTE_REQUIRED_STATUSES,
  staffLeadAssignRequestSchema,
  staffLeadMetricsRequestSchema,
  staffLeadNoteRequestSchema,
  staffLeadsRequestSchema,
  staffLeadTransitionRequestSchema,
  staffLeadUnassignRequestSchema,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import { changeLeadStatus, type TransactionalPool } from '../inquiries/lead-status-write';
import type { Queryable } from '../inquiries/write';
import { checkAgentForLead, hasOpenAssignment, openAssignment } from './agents-store';
import { readLeadMetrics } from './metrics-store';
import type { ContactsClient } from '../inquiries/account-contacts';
import { addLeadNote, decodeCursor, encodeCursor, listLeads, readLeadDetail } from './leads-store';
import { hasAnyRole, requireRole, ROLE, staffCallerOf } from './roles';
import { actingRole, asyncRoute, describeIssues, invalidRequest } from './route-helpers';

export interface StaffLeadsRouterDeps {
  pool: Queryable & TransactionalPool;
  introspection: IntrospectionClient;
  /** Buyer name and email come from the account (#691). */
  contacts: ContactsClient;
  /** A lead in `new` or `verified` for longer than this counts as aging. Default 24. */
  agingHours?: number;
}

/** The roles that run the lead desk. `SuperAdmin` passes through `Admin` (see `hasAnyRole`). */
const LEAD_DESK_ROLES = [ROLE.Admin, ROLE.Moderator] as const;

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
      const page = await listLeads(deps.pool, deps.contacts, {
        filters,
        limit: limit ?? STAFF_LEADS_PAGE_SIZE_DEFAULT,
        cursor,
      });
      res
        .status(200)
        .json({ results: page.results, nextCursor: page.next ? encodeCursor(page.next) : null });
    }),
  );

  // Registered before `/staff/leads/:id`, which would read "metrics" as an id.
  router.get(
    '/staff/leads/metrics',
    guard,
    asyncRoute(async (req, res) => {
      const parsed = staffLeadMetricsRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(invalidRequest(describeIssues(parsed.error.issues)));
        return;
      }
      const { from, to } = parsed.data;
      if (from !== undefined && to !== undefined && Date.parse(from) >= Date.parse(to)) {
        res.status(400).json(invalidRequest('Invalid or unknown field(s): from, to.'));
        return;
      }
      res
        .status(200)
        .json(
          await readLeadMetrics(
            deps.pool,
            parsed.data,
            deps.agingHours ?? STAFF_LEAD_AGING_HOURS_DEFAULT,
          ),
        );
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
      const detail = await readLeadDetail(deps.pool, deps.contacts, id.data, {
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

  /**
   * Assign (#634). The agent checks run inside the status transaction, behind the row lock, so a
   * concurrent assign sees the new status and fails the transition. The request has one field.
   */
  router.post(
    '/staff/leads/:id/assign',
    guard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      const body = staffLeadAssignRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      const caller = staffCallerOf(res);
      const { agentProfileId } = body.data;
      const result = await changeLeadStatus(deps.pool, {
        leadId: id.data,
        to: 'assigned',
        actorAccountId: caller.accountId,
        actorRole: actingRole(caller.roles),
        agentProfileId,
        precheck: async (client) => {
          const rejection = await checkAgentForLead(client, id.data, agentProfileId);
          if (rejection !== null) return rejection;
          await openAssignment(client, {
            leadId: id.data,
            agentProfileId,
            assignedByAccountId: caller.accountId,
          });
          return null;
        },
      });
      if (!result.ok) {
        if (result.reason === 'not_found') res.status(404).json(LEAD_NOT_FOUND_BODY);
        else if (result.reason === 'invalid_transition')
          res.status(409).json(INVALID_TRANSITION_BODY);
        else if (result.code === 'agent_not_found') res.status(404).json(AGENT_NOT_FOUND_BODY);
        else if (result.code === 'agent_inactive') res.status(409).json(AGENT_INACTIVE_BODY);
        else res.status(409).json(AGENT_NOT_LICENSED_BODY);
        return;
      }
      res.status(200).json({ id: id.data, from: result.from, to: result.to, agentProfileId });
    }),
  );

  /** Unassign (#634). Back to `verified`. Reassign is an unassign, then an assign. */
  router.post(
    '/staff/leads/:id/unassign',
    guard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      const body = staffLeadUnassignRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      const caller = staffCallerOf(res);
      const result = await changeLeadStatus(deps.pool, {
        leadId: id.data,
        to: 'verified',
        actorAccountId: caller.accountId,
        actorRole: actingRole(caller.roles),
        note: body.data.note,
        assignmentEndReason: 'unassigned',
        // Without this, `unassign` would also verify a `new` lead.
        precheck: async (client) =>
          (await hasOpenAssignment(client, id.data)) ? null : 'not_assigned',
      });
      if (!result.ok) {
        if (result.reason === 'not_found') res.status(404).json(LEAD_NOT_FOUND_BODY);
        else if (result.reason === 'invalid_transition')
          res.status(409).json(INVALID_TRANSITION_BODY);
        else res.status(409).json(LEAD_NOT_ASSIGNED_BODY);
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
