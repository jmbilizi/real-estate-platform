import { type Request, type RequestHandler, type Response, Router } from 'express';
import {
  agentLeadDeclineRequestSchema,
  agentLeadsRequestSchema,
  agentLeadStatusRequestSchema,
  FORBIDDEN_BODY,
  idSchema,
  INVALID_TRANSITION_BODY,
  LEAD_NOT_FOUND_BODY,
  type LeadStatus,
} from '@cribstop/property-contracts';
import type { ContactsClient } from '../inquiries/account-contacts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import {
  changeLeadStatus,
  type ChangeLeadStatusInput,
  type TransactionalPool,
} from '../inquiries/lead-status-write';
import type { Queryable } from '../inquiries/write';
import { requireRole, ROLE, staffCallerOf } from '../staff/roles';
import { asyncRoute, describeIssues, invalidRequest } from '../staff/route-helpers';
import {
  findActiveAgentProfileId,
  listAgentLeads,
  markAccepted,
  markDeclineReason,
  ownsOpenAssignment,
  readAgentLeadDetail,
} from './agent-leads-store';

export interface AgentLeadsRouterDeps {
  pool: Queryable & TransactionalPool;
  introspection: IntrospectionClient;
  /** Buyer name and email come from the account (#691). */
  contacts: ContactsClient;
}

const ACTOR_ROLE = 'Agent';
const NOT_OWNED = 'not_owned';
const WRONG_STATE = 'wrong_state';

/**
 * The agent "My leads" API (#636). The caller holds the `Agent` role AND an active profile, else
 * 403. A lead without an open assignment to the caller answers 404, never 403, so an id reveals
 * nothing. Every response is `private, no-store`.
 */
export function createAgentLeadsRouter(deps: AgentLeadsRouterDeps): Router {
  const router = Router();
  const roleGuard = requireRole(deps.introspection, ROLE.Agent);

  const profileGuard: RequestHandler = (_req, res, next) => {
    const { accountId } = staffCallerOf(res);
    findActiveAgentProfileId(deps.pool, accountId)
      .then((profileId) => {
        if (profileId === null) {
          res.status(403).json(FORBIDDEN_BODY);
          return;
        }
        (res.locals as { agentProfileId?: string }).agentProfileId = profileId;
        next();
      })
      .catch(next);
  };
  const guard = [roleGuard, profileGuard];
  const profileOf = (res: Response) => (res.locals as { agentProfileId: string }).agentProfileId;

  router.get(
    '/agent/leads',
    guard,
    asyncRoute(async (req, res) => {
      const parsed = agentLeadsRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(invalidRequest(describeIssues(parsed.error.issues)));
        return;
      }
      res.status(200).json({
        results: await listAgentLeads(deps.pool, deps.contacts, profileOf(res), parsed.data.status),
      });
    }),
  );

  router.get(
    '/agent/leads/:id',
    guard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      const detail = id.success
        ? await readAgentLeadDetail(deps.pool, deps.contacts, profileOf(res), id.data, {
            accountId: staffCallerOf(res).accountId,
          })
        : null;
      if (detail === null) {
        res.status(404).json(LEAD_NOT_FOUND_BODY);
        return;
      }
      res.status(200).json(detail);
    }),
  );

  /**
   * One status change by the owner. The 404 for a lead that is not the caller's comes BEFORE the
   * transition check, so a 409 never confirms that another agent's lead exists. The same check
   * runs again inside the transaction, behind the row lock, for a concurrent unassign.
   */
  async function change(
    req: Request,
    res: Response,
    build: (
      agentProfileId: string,
      leadId: string,
    ) => Pick<ChangeLeadStatusInput, 'to' | 'note' | 'assignmentEndReason'> & {
      precheck: (client: Queryable, from: LeadStatus) => Promise<string | null>;
    },
  ): Promise<void> {
    const id = idSchema.safeParse(req.params.id);
    const agentProfileId = profileOf(res);
    if (!id.success || !(await ownsOpenAssignment(deps.pool, id.data, agentProfileId))) {
      res.status(404).json(LEAD_NOT_FOUND_BODY);
      return;
    }
    const leadId = id.data;
    const { precheck, ...change } = build(agentProfileId, leadId);
    const result = await changeLeadStatus(deps.pool, {
      ...change,
      leadId,
      actorAccountId: staffCallerOf(res).accountId,
      actorRole: ACTOR_ROLE,
      agentProfileId,
      precheck: async (client, from) =>
        (await ownsOpenAssignment(client, leadId, agentProfileId))
          ? precheck(client, from)
          : NOT_OWNED,
    });
    if (result.ok) {
      res.status(200).json({ id: leadId, from: result.from, to: result.to });
    } else if (
      result.reason === 'not_found' ||
      (result.reason === 'rejected' && result.code === NOT_OWNED)
    ) {
      res.status(404).json(LEAD_NOT_FOUND_BODY);
    } else {
      res.status(409).json(INVALID_TRANSITION_BODY);
    }
  }

  router.post(
    '/agent/leads/:id/accept',
    guard,
    asyncRoute((req, res) =>
      change(req, res, (agentProfileId, leadId) => ({
        to: 'accepted',
        precheck: async (client) => {
          await markAccepted(client, leadId, agentProfileId);
          return null;
        },
      })),
    ),
  );

  router.post(
    '/agent/leads/:id/decline',
    guard,
    asyncRoute(async (req, res) => {
      const body = agentLeadDeclineRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      await change(req, res, (agentProfileId, leadId) => ({
        to: 'verified',
        note: `Declined: ${body.data.reason}`,
        assignmentEndReason: 'declined',
        // After accept the agent works the lead or marks it lost. Only an `assigned` lead is declined.
        precheck: async (client, from) => {
          if (from !== 'assigned') return WRONG_STATE;
          await markDeclineReason(client, leadId, agentProfileId, body.data.reason);
          return null;
        },
      }));
    }),
  );

  router.post(
    '/agent/leads/:id/status',
    guard,
    asyncRoute(async (req, res) => {
      const body = agentLeadStatusRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      await change(req, res, () => ({
        to: body.data.to,
        note: body.data.note ?? null,
        // The agent accepts first. `assigned` to `lost` is a staff move.
        precheck: (_client, from) => Promise.resolve(from === 'assigned' ? WRONG_STATE : null),
      }));
    }),
  );

  return router;
}
