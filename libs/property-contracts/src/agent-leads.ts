import { z } from 'zod';
import { idSchema } from './common';
import { consentChannelSchema, inquiryKindSchema, leadStatusSchema } from './listing-inquiry';
import { staffLeadListingSchema } from './staff';

/**
 * Agent "My leads" (#636). An agent sees only the leads with an open assignment to the agent's
 * profile. Contact details stay masked until the agent accepts. Fair Housing (PRD §6): no field
 * here holds a trait of the buyer, and the decline reasons name no buyer trait.
 */

/** The fixed list of decline reasons. No free text, so a reason cannot hold a buyer trait. */
export const AGENT_DECLINE_REASONS = [
  'no_capacity',
  'outside_service_area',
  'conflict_of_interest',
  'listing_unavailable',
  'other',
] as const;
export const agentDeclineReasonSchema = z.enum(AGENT_DECLINE_REASONS);
export type AgentDeclineReason = z.infer<typeof agentDeclineReasonSchema>;

/** The statuses an agent sets after accepting. The transitions table decides the order. */
export const AGENT_STATUS_TARGETS = [
  'contacted',
  'touring',
  'under_contract',
  'closed',
  'lost',
] as const;
export const AGENT_NOTE_MAX_LENGTH = 2000;

/** Shown on every agent detail. The agent owns the written buyer agreement. We do not track it. */
export const AGENT_BUYER_AGREEMENT_REMINDER =
  'Get a written buyer agreement signed before you tour a home with this buyer.';

export const agentLeadsRequestSchema = z.strictObject({
  status: leadStatusSchema.optional(),
});
export type AgentLeadsRequest = z.infer<typeof agentLeadsRequestSchema>;

export const agentLeadListItemSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  assignedAt: z.iso.datetime(),
  /** The accept time. Null until the agent accepts. Speed-to-lead reads it. */
  acceptedAt: z.iso.datetime().nullable(),
  kind: inquiryKindSchema,
  status: leadStatusSchema,
  listing: staffLeadListingSchema,
  /** Masked: first character, then `***`, then the domain. */
  emailMasked: z.string().nullable(),
  /** Masked: only the last four digits. Null when the buyer gave no phone. */
  phoneMasked: z.string().nullable(),
});
export type AgentLeadListItem = z.infer<typeof agentLeadListItemSchema>;

export const agentLeadsEnvelopeSchema = z.object({ results: z.array(agentLeadListItemSchema) });
export type AgentLeadsEnvelope = z.infer<typeof agentLeadsEnvelopeSchema>;

export const agentLeadContactSchema = z.object({
  /** Name and email come from the buyer's account (#691). Null when account-service cannot answer. */
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  message: z.string().nullable(),
  consent: z.object({
    given: z.boolean(),
    text: z.string().nullable(),
    channels: z.array(consentChannelSchema),
    givenAt: z.iso.datetime().nullable(),
  }),
});

export const agentLeadDetailSchema = agentLeadListItemSchema.extend({
  /** Null while the status is `assigned`. Accept reveals it. */
  contact: agentLeadContactSchema.nullable(),
  /** A reminder of the agent's duty before a tour. */
  buyerAgreementReminder: z.literal(AGENT_BUYER_AGREEMENT_REMINDER),
});
export type AgentLeadDetail = z.infer<typeof agentLeadDetailSchema>;

/** Body of `POST /agent/leads/{id}/decline`. */
export const agentLeadDeclineRequestSchema = z.strictObject({ reason: agentDeclineReasonSchema });
export type AgentLeadDeclineRequest = z.infer<typeof agentLeadDeclineRequestSchema>;

/** Body of `POST /agent/leads/{id}/status`. */
export const agentLeadStatusRequestSchema = z.strictObject({
  to: z.enum(AGENT_STATUS_TARGETS),
  note: z.string().trim().min(1).max(AGENT_NOTE_MAX_LENGTH).optional(),
});
export type AgentLeadStatusRequest = z.infer<typeof agentLeadStatusRequestSchema>;

export const agentLeadTransitionResponseSchema = z.object({
  id: idSchema,
  from: leadStatusSchema,
  to: leadStatusSchema,
});
