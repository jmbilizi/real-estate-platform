import { Router } from 'express';
import {
  AGENT_EXISTS_BODY,
  AGENT_NOT_FOUND_BODY,
  AGENT_ROLE_REQUIRED_BODY,
  createAgentProfileRequestSchema,
  idSchema,
  staffAgentsRequestSchema,
  UNAVAILABLE_BODY,
  updateAgentProfileRequestSchema,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { Queryable } from '../inquiries/write';
import { credentialsOf } from '../saved/identity';
import type { AgentRoleChecker } from './agent-role-check';
import { createAgent, getAgent, listAgents, updateAgent } from './agents-store';
import { requireRole, ROLE } from './roles';
import { asyncRoute, describeIssues, invalidRequest } from './route-helpers';

export interface StaffAgentsRouterDeps {
  pool: Queryable;
  introspection: IntrospectionClient;
  agentRoles: AgentRoleChecker;
}

/**
 * The agent directory (#634). Admin and SuperAdmin write. Moderator also reads, because a
 * Moderator picks the agent in the assign screen. Every response is `private, no-store`.
 */
export function createStaffAgentsRouter(deps: StaffAgentsRouterDeps): Router {
  const router = Router();
  const readGuard = requireRole(deps.introspection, ROLE.Admin, ROLE.Moderator);
  const writeGuard = requireRole(deps.introspection, ROLE.Admin);

  router.get(
    '/staff/agents',
    readGuard,
    asyncRoute(async (req, res) => {
      const parsed = staffAgentsRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(invalidRequest(describeIssues(parsed.error.issues)));
        return;
      }
      res.status(200).json({ results: await listAgents(deps.pool, parsed.data) });
    }),
  );

  router.get(
    '/staff/agents/:id',
    readGuard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      const agent = id.success ? await getAgent(deps.pool, id.data) : null;
      if (agent === null) {
        res.status(404).json(AGENT_NOT_FOUND_BODY);
        return;
      }
      res.status(200).json(agent);
    }),
  );

  router.post(
    '/staff/agents',
    writeGuard,
    asyncRoute(async (req, res) => {
      const body = createAgentProfileRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      const role = await deps.agentRoles.check(body.data.accountId, credentialsOf(req));
      if (role === 'unavailable') {
        res.set('Retry-After', '2').status(503).json(UNAVAILABLE_BODY);
        return;
      }
      if (role === 'no-role') {
        res.status(409).json(AGENT_ROLE_REQUIRED_BODY);
        return;
      }
      const agent = await createAgent(deps.pool, body.data);
      if (agent === null) {
        res.status(409).json(AGENT_EXISTS_BODY);
        return;
      }
      res.status(201).json(agent);
    }),
  );

  router.patch(
    '/staff/agents/:id',
    writeGuard,
    asyncRoute(async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      const current = id.success ? await getAgent(deps.pool, id.data) : null;
      if (!id.success || current === null) {
        res.status(404).json(AGENT_NOT_FOUND_BODY);
        return;
      }
      const body = updateAgentProfileRequestSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json(invalidRequest(describeIssues(body.error.issues)));
        return;
      }
      // Reactivation hands the agent new leads again, so the role must still hold.
      if (body.data.active === true && !current.active) {
        const role = await deps.agentRoles.check(current.accountId, credentialsOf(req));
        if (role === 'unavailable') {
          res.set('Retry-After', '2').status(503).json(UNAVAILABLE_BODY);
          return;
        }
        if (role === 'no-role') {
          res.status(409).json(AGENT_ROLE_REQUIRED_BODY);
          return;
        }
      }
      const agent = await updateAgent(deps.pool, id.data, body.data);
      if (agent === null) {
        res.status(404).json(AGENT_NOT_FOUND_BODY);
        return;
      }
      res.status(200).json(agent);
    }),
  );

  return router;
}
