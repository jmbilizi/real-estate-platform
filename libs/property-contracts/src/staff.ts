import { z } from 'zod';
import { idSchema } from './common';
import { consentChannelSchema, inquiryKindSchema, leadStatusSchema } from './listing-inquiry';

/**
 * `GET /staff/me` (#628). The roles of the calling account, as a list: accounts are multi-role
 * (PRD §11.2), so there is no persona field. A buyer-only account gets `["User"]`.
 */
export const staffMeSchema = z.object({
  roles: z.array(z.string()),
});

export type StaffMe = z.infer<typeof staffMeSchema>;

/**
 * Staff lead desk (#632). Admin, SuperAdmin and Moderator read every lead. The list masks the
 * contact fields. Only the detail carries them, and each detail read writes an audit row.
 *
 * Fair Housing (PRD §6): no field here holds a personal trait of the requester. The only free text
 * is the requester's own message and the staff note.
 */

export const STAFF_LEADS_PAGE_SIZE_DEFAULT = 25;
export const STAFF_LEADS_PAGE_SIZE_MAX = 50;
export const STAFF_NOTE_MAX_LENGTH = 2000;
/** Statuses that need a staff note. */
export const STAFF_NOTE_REQUIRED_STATUSES = ['spam', 'rejected'] as const;
/** What a Moderator may set. Admin and SuperAdmin may also restore a spam lead to `new`. */
export const MODERATOR_TARGET_STATUSES = ['verified', 'spam', 'rejected'] as const;
/** Window for the possible-duplicate flag. */
export const DUPLICATE_WINDOW_DAYS = 7;

const queryLimit = z
  .string()
  .regex(/^([1-9]|[1-4][0-9]|50)$/, `must be a whole number from 1 to ${STAFF_LEADS_PAGE_SIZE_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(STAFF_LEADS_PAGE_SIZE_MAX))
  .describe(
    `Whole number from 1 to ${STAFF_LEADS_PAGE_SIZE_MAX}. Default ${STAFF_LEADS_PAGE_SIZE_DEFAULT}.`,
  );

/** Query of `GET /staff/leads`. Unknown parameters are rejected. */
export const staffLeadsRequestSchema = z
  .strictObject({
    status: leadStatusSchema.optional(),
    kind: inquiryKindSchema.optional(),
    createdFrom: z.iso
      .datetime({ offset: true })
      .optional()
      .describe('Inclusive lower bound on the creation time. ISO 8601 with a zone.'),
    createdTo: z.iso
      .datetime({ offset: true })
      .optional()
      .describe('Exclusive upper bound on the creation time. ISO 8601 with a zone.'),
    listingId: idSchema.optional(),
    limit: queryLimit.optional(),
    cursor: z
      .string()
      .max(200)
      .optional()
      .describe('The `nextCursor` of the previous page. Opaque.'),
  })
  .refine(
    (q) =>
      q.createdFrom === undefined ||
      q.createdTo === undefined ||
      Date.parse(q.createdFrom) < Date.parse(q.createdTo),
    { message: 'createdFrom must be before createdTo', path: ['createdFrom'] },
  );
export type StaffLeadsRequest = z.infer<typeof staffLeadsRequestSchema>;

export const staffLeadListingSchema = z.object({
  id: idSchema,
  title: z.string(),
  address: z.string(),
  /** Two-letter upper-case state of the listing. Null when the property has none. */
  state: z.string().nullable(),
  listPrice: z.number().nullable(),
  status: z.string().nullable(),
});

export const staffLeadListItemSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  kind: inquiryKindSchema,
  status: leadStatusSchema,
  name: z.string(),
  /** Masked: first character, then `***`, then the domain. */
  emailMasked: z.string(),
  /** Masked: only the last four digits. Null when the requester gave no phone. */
  phoneMasked: z.string().nullable(),
  verifiedAccount: z.boolean(),
  listingId: idSchema,
  /**
   * True when another open request on the same listing came within seven days from the same
   * normalized email or phone. A hint for staff. The server never merges or drops a lead.
   */
  possibleDuplicate: z.boolean(),
});
export type StaffLeadListItem = z.infer<typeof staffLeadListItemSchema>;

export const staffLeadsEnvelopeSchema = z.object({
  results: z.array(staffLeadListItemSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type StaffLeadsEnvelope = z.infer<typeof staffLeadsEnvelopeSchema>;

export const staffLeadStatusEventSchema = z.object({
  id: idSchema,
  fromStatus: leadStatusSchema.nullable(),
  toStatus: leadStatusSchema,
  actorAccountId: idSchema.nullable(),
  actorRole: z.string(),
  note: z.string().nullable(),
  /** The agent an assign or unassign event names. Null for every other event. */
  agentProfileId: idSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const staffLeadNoteSchema = z.object({
  id: idSchema,
  authorAccountId: idSchema,
  authorRole: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type StaffLeadNote = z.infer<typeof staffLeadNoteSchema>;

export const ASSIGNMENT_END_REASONS = ['unassigned', 'returned', 'closed', 'declined'] as const;

/** One row of the assignment history of a lead. `endedAt` is null for the open assignment. */
export const staffLeadAssignmentSchema = z.object({
  id: idSchema,
  agentProfileId: idSchema,
  agentDisplayName: z.string(),
  assignedByAccountId: idSchema,
  assignedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** `unassigned`: staff removed the agent. `returned`: the lead went back to `verified` otherwise. `closed`: the lead ended as `lost` or `closed`. `declined`: the agent declined. */
  endReason: z.enum(ASSIGNMENT_END_REASONS).nullable(),
});
export type StaffLeadAssignment = z.infer<typeof staffLeadAssignmentSchema>;

export const staffLeadDetailSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  kind: inquiryKindSchema,
  status: leadStatusSchema,
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  message: z.string().nullable(),
  verifiedAccount: z.boolean(),
  consent: z.object({
    given: z.boolean(),
    textVersion: z.string().nullable(),
    text: z.string().nullable(),
    channels: z.array(consentChannelSchema),
    givenAt: z.iso.datetime().nullable(),
  }),
  listing: staffLeadListingSchema,
  possibleDuplicate: z.boolean(),
  /** Up to ten ids of the matching requests, newest first. Staff decide what to do. */
  duplicateLeadIds: z.array(idSchema),
  history: z.array(staffLeadStatusEventSchema),
  notes: z.array(staffLeadNoteSchema),
  /** Every assignment, oldest first. At most the last one is open. */
  assignments: z.array(staffLeadAssignmentSchema),
});
export type StaffLeadDetail = z.infer<typeof staffLeadDetailSchema>;

/** Body of `POST /staff/leads/{id}/transition`. A note is required for `spam` and `rejected`. */
export const staffLeadTransitionRequestSchema = z.strictObject({
  to: leadStatusSchema,
  note: z.string().trim().min(1).max(STAFF_NOTE_MAX_LENGTH).optional(),
});
export type StaffLeadTransitionRequest = z.infer<typeof staffLeadTransitionRequestSchema>;

export const staffLeadTransitionResponseSchema = z.object({
  id: idSchema,
  from: leadStatusSchema,
  to: leadStatusSchema,
});

/** Body of `POST /staff/leads/{id}/notes`. Notes are append-only. */
export const staffLeadNoteRequestSchema = z.strictObject({
  body: z.string().trim().min(1).max(STAFF_NOTE_MAX_LENGTH),
});

/**
 * Agent directory and manual assignment (#634). Matching considers the licence state and the
 * listing state, and nothing else. No field here holds a trait of the buyer, and the assign
 * request has no free-text field (Fair Housing, PRD §6).
 */

/** Every agent sits in our own brokerage. The value is fixed, not client input. */
export const AGENT_BROKERAGE = 'Real Broker, LLC';
export const AGENT_LICENCE_STATES_MAX = 60;

/** A two-letter state code. The set of markets is data: no state is hard-coded. */
export const licenceStateSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be a two-letter upper-case state code');

const licenceStatesSchema = z
  .array(licenceStateSchema)
  .min(1)
  .max(AGENT_LICENCE_STATES_MAX)
  .refine((states) => new Set(states).size === states.length, {
    message: 'must not repeat a state',
  });

const displayNameSchema = z.string().trim().min(1).max(100);
const licenceNumberSchema = z.string().trim().min(1).max(40);

export const agentProfileSchema = z.object({
  id: idSchema,
  /** The account that holds the `Agent` role. */
  accountId: idSchema,
  displayName: z.string(),
  licenceNumber: z.string(),
  licenceStates: z.array(licenceStateSchema),
  brokerage: z.literal(AGENT_BROKERAGE),
  /** A deactivated agent gets no new leads. Open assignments stay. */
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

/** Query of `GET /staff/agents`. Unknown parameters are rejected. */
export const staffAgentsRequestSchema = z.strictObject({
  active: z
    .enum(['true', 'false'])
    .optional()
    .describe('Only active (`true`) or only deactivated (`false`) agents.'),
  licenceState: licenceStateSchema.optional().describe('Only agents licensed in this state.'),
});
export type StaffAgentsRequest = z.infer<typeof staffAgentsRequestSchema>;

export const staffAgentsEnvelopeSchema = z.object({ results: z.array(agentProfileSchema) });
export type StaffAgentsEnvelope = z.infer<typeof staffAgentsEnvelopeSchema>;

/** Body of `POST /staff/agents`. */
export const createAgentProfileRequestSchema = z.strictObject({
  accountId: idSchema,
  displayName: displayNameSchema,
  licenceNumber: licenceNumberSchema,
  licenceStates: licenceStatesSchema,
  active: z.boolean().optional(),
});
export type CreateAgentProfileRequest = z.infer<typeof createAgentProfileRequestSchema>;

/** Body of `PATCH /staff/agents/{id}`. The account never changes. At least one field is needed. */
export const updateAgentProfileRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    licenceNumber: licenceNumberSchema.optional(),
    licenceStates: licenceStatesSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });
export type UpdateAgentProfileRequest = z.infer<typeof updateAgentProfileRequestSchema>;

/** Body of `POST /staff/leads/{id}/assign`. One field: no reason, no free text. */
export const staffLeadAssignRequestSchema = z.strictObject({ agentProfileId: idSchema });
export type StaffLeadAssignRequest = z.infer<typeof staffLeadAssignRequestSchema>;

export const staffLeadAssignResponseSchema = z.object({
  id: idSchema,
  from: leadStatusSchema,
  to: leadStatusSchema,
  agentProfileId: idSchema,
});

/** Body of `POST /staff/leads/{id}/unassign`. The note is required. */
export const staffLeadUnassignRequestSchema = z.strictObject({
  note: z.string().trim().min(1).max(STAFF_NOTE_MAX_LENGTH),
});
export type StaffLeadUnassignRequest = z.infer<typeof staffLeadUnassignRequestSchema>;
