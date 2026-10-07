import {
  type AgentDeclineReason,
  type AgentLeadDetail,
  agentLeadDetailSchema,
  type AgentLeadsEnvelope,
  agentLeadsEnvelopeSchema,
  agentLeadTransitionResponseSchema,
} from '@cribstop/property-contracts';
import type { AgentTarget } from '@/lib/agent-leads';
import { call, parse } from './staff-leads';

/** Browser client of the agent routes. It shares the error type of the staff client. */

const JSON_POST = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const leadUrl = (id: string) => `/api/agent/leads/${encodeURIComponent(id)}`;

export async function fetchAgentLeads(): Promise<AgentLeadsEnvelope> {
  return parse(agentLeadsEnvelopeSchema, await call('/api/agent/leads'));
}

export async function fetchAgentLead(id: string): Promise<AgentLeadDetail> {
  return parse(agentLeadDetailSchema, await call(leadUrl(id)));
}

export async function acceptLead(id: string): Promise<void> {
  parse(agentLeadTransitionResponseSchema, await call(`${leadUrl(id)}/accept`, { method: 'POST' }));
}

export async function declineLead(id: string, reason: AgentDeclineReason): Promise<void> {
  parse(
    agentLeadTransitionResponseSchema,
    await call(`${leadUrl(id)}/decline`, JSON_POST({ reason })),
  );
}

export async function setLeadStatus(id: string, to: AgentTarget, note?: string): Promise<void> {
  parse(
    agentLeadTransitionResponseSchema,
    await call(`${leadUrl(id)}/status`, JSON_POST(note ? { to, note } : { to })),
  );
}
