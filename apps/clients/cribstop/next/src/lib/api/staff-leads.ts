import {
  type InquiryKind,
  type LeadStatus,
  staffLeadAssignResponseSchema,
  type StaffLeadDetail,
  staffLeadDetailSchema,
  type StaffLeadMetrics,
  staffLeadMetricsSchema,
  type StaffLeadNote,
  staffLeadNoteSchema,
  type StaffLeadsEnvelope,
  staffLeadsEnvelopeSchema,
  staffLeadTransitionResponseSchema,
} from '@cribstop/property-contracts';
import type { StaffAction } from '@/lib/staff-leads';

/** Browser client of the staff routes. Nothing here is cached or stored: the caller holds the view. */

export type StaffFailure = 'forbidden' | 'not_found' | 'conflict' | 'invalid' | 'unavailable';

export class StaffApiError extends Error {
  constructor(
    readonly failure: StaffFailure,
    message: string,
  ) {
    super(message);
    this.name = 'StaffApiError';
  }
}

const FALLBACK: Record<StaffFailure, string> = {
  forbidden: 'You do not have access to this action.',
  not_found: 'This request no longer exists.',
  conflict: 'This request cannot move to that status.',
  invalid: 'The request was not accepted. Check the fields and try again.',
  unavailable: 'The lead desk could not be reached. Try again.',
};

function failureOf(status: number): StaffFailure {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400) return 'invalid';
  return 'unavailable';
}

export async function call(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    throw new StaffApiError('unavailable', FALLBACK.unavailable);
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return body;
  const failure = failureOf(res.status);
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  throw new StaffApiError(failure, typeof message === 'string' ? message : FALLBACK[failure]);
}

export function parse<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch {
    throw new StaffApiError('unavailable', FALLBACK.unavailable);
  }
}

export interface LeadFilters {
  status?: LeadStatus;
  kind?: InquiryKind;
  createdFrom?: string;
  createdTo?: string;
  listingId?: string;
}

export async function fetchLeads(
  filters: LeadFilters,
  cursor?: string,
): Promise<StaffLeadsEnvelope> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, cursor })) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return parse(staffLeadsEnvelopeSchema, await call(`/api/staff/leads${qs ? `?${qs}` : ''}`));
}

export async function fetchLeadMetrics(range: {
  from?: string;
  to?: string;
}): Promise<StaffLeadMetrics> {
  const query = new URLSearchParams();
  if (range.from) query.set('from', range.from);
  if (range.to) query.set('to', range.to);
  const qs = query.toString();
  return parse(staffLeadMetricsSchema, await call(`/api/staff/leads/metrics${qs ? `?${qs}` : ''}`));
}

export async function fetchLead(id: string): Promise<StaffLeadDetail> {
  return parse(staffLeadDetailSchema, await call(`/api/staff/leads/${encodeURIComponent(id)}`));
}

const JSON_POST = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function transitionLead(id: string, to: StaffAction, note?: string): Promise<void> {
  const body = await call(
    `/api/staff/leads/${encodeURIComponent(id)}/transition`,
    JSON_POST(note ? { to, note } : { to }),
  );
  parse(staffLeadTransitionResponseSchema, body);
}

/** Assign has one field. There is no reason or free text (Fair Housing). */
export async function assignLead(id: string, agentProfileId: string): Promise<void> {
  const body = await call(
    `/api/staff/leads/${encodeURIComponent(id)}/assign`,
    JSON_POST({ agentProfileId }),
  );
  parse(staffLeadAssignResponseSchema, body);
}

export async function unassignLead(id: string, note: string): Promise<void> {
  const body = await call(
    `/api/staff/leads/${encodeURIComponent(id)}/unassign`,
    JSON_POST({ note }),
  );
  parse(staffLeadTransitionResponseSchema, body);
}

export async function addLeadNote(id: string, text: string): Promise<StaffLeadNote> {
  const body = await call(
    `/api/staff/leads/${encodeURIComponent(id)}/notes`,
    JSON_POST({ body: text }),
  );
  return parse(staffLeadNoteSchema, body);
}
