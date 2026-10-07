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
