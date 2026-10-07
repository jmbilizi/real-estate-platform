import {
  type AgentProfile,
  agentProfileSchema,
  type CreateAgentProfileRequest,
  staffAgentsEnvelopeSchema,
  type UpdateAgentProfileRequest,
} from '@cribstop/property-contracts';
import { call, parse } from './staff-leads';

/** Browser client of the agent directory routes. Nothing here is cached or stored. */

export interface AgentFilters {
  active?: 'true' | 'false';
  licenceState?: string;
}

export async function fetchAgents(filters: AgentFilters = {}): Promise<AgentProfile[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  const body = parse(
    staffAgentsEnvelopeSchema,
    await call(`/api/staff/agents${qs ? `?${qs}` : ''}`),
  );
  return body.results;
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function createAgent(input: CreateAgentProfileRequest): Promise<AgentProfile> {
  return parse(agentProfileSchema, await call('/api/staff/agents', send('POST', input)));
}

export async function updateAgent(
  id: string,
  patch: UpdateAgentProfileRequest,
): Promise<AgentProfile> {
  return parse(
    agentProfileSchema,
    await call(`/api/staff/agents/${encodeURIComponent(id)}`, send('PATCH', patch)),
  );
}
