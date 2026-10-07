import { z } from 'zod';
import { idSchema } from './common';

/** The two CTAs `ListingDetailContent.tsx` renders (#131). */
export const INQUIRY_KINDS = ['message', 'tour_request'] as const;
export const inquiryKindSchema = z.enum(INQUIRY_KINDS);
export type InquiryKind = z.infer<typeof inquiryKindSchema>;

const MESSAGE_MAX_LENGTH = 2000;

/**
 * Stakeholder ruling 2026-09-13. The consumer sees this exact sentence next to the consent
 * checkbox; the server persists it verbatim on a consented inquiry (never a client-supplied
 * string), so the wire text and the audited record can never drift. #132 renders it from here.
 *
 * Real Broker, LLC leads (PRD §6.1 brand prominence — the licensed brokerage, never the product
 * name, is the most prominent brand). The contact medium, autodialer/prerecorded-message
 * disclosure, and "not a condition of service" statement are the TCPA floor (PRD §6.4) for a
 * checkbox that collects a phone number.
 */
const CONSENT_TEXT_V1 =
  "I agree that Real Broker, LLC (Cribstop's brokerage) and its agents may contact me about this " +
  'home by phone, text message, or email, including by autodialer or prerecorded message. ' +
  'Consent is not required to use Cribstop, and message and data rates may apply.';

/**
 * The consent text per version (#627). The server stores the text, the version, the channels and
 * the time with each request. A client names a version and never sends its own text. A wording
 * change adds a new version. It never edits an old one, because stored rows point at the old one.
 */
export const CONSENT_TEXTS = { v1: CONSENT_TEXT_V1 } as const;
export const CONSENT_TEXT_VERSIONS = ['v1'] as const;
export const consentTextVersionSchema = z.enum(CONSENT_TEXT_VERSIONS);
export type ConsentTextVersion = z.infer<typeof consentTextVersionSchema>;
export const CURRENT_CONSENT_TEXT_VERSION: ConsentTextVersion = 'v1';

/** The text of `CURRENT_CONSENT_TEXT_VERSION`. Kept for the current web form. */
export const CONSENT_DISCLOSURE_TEXT = CONSENT_TEXTS[CURRENT_CONSENT_TEXT_VERSION];

export const CONSENT_CHANNELS = ['email', 'phone_call', 'phone_text'] as const;
export const consentChannelSchema = z.enum(CONSENT_CHANNELS);
export type ConsentChannel = z.infer<typeof consentChannelSchema>;

/** The lead lifecycle (#627). The allowed transitions live in the property-service. */
export const LEAD_STATUSES = [
  'new',
  'verified',
  'assigned',
  'accepted',
  'contacted',
  'touring',
  'under_contract',
  'closed',
  'lost',
  'spam',
  'rejected',
] as const;
export const leadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/**
 * The request body for `POST /listings/{id}/inquiries`.
 *
 * `.strictObject()`: an unknown field is rejected outright, which is the Fair Housing guardrail
 * this schema exists to enforce (PRD §6, #34) — there is no age, household size, occupancy,
 * familial status or disability field to strip, because none can ever be added without a
 * reviewed schema change reaching this file first.
 *
 * `name` and `email` are required regardless of sign-in state. `phone` is optional (ruling
 * 2026-10-06).
 * Signed-in resolves an account id server-side (#86). It does not excuse the caller from
 * submitting contact details, because the inquiry must remain readable on its own even if the
 * account is later deleted.
 *
 * `consentToContact` defaults to `false` and is never inferred from anything else. Absent means
 * no consent, matching the stakeholder ruling: nothing but the consumer's own submission may set
 * it.
 */
export const listingInquiryRequestSchema = z
  .strictObject({
    kind: inquiryKindSchema,
    name: z.string().trim().min(1).max(200),
    email: z.email(),
    phone: z.string().trim().min(1).max(40).optional(),
    message: z
      .string()
      .trim()
      .max(MESSAGE_MAX_LENGTH)
      .optional()
      .describe(
        'Required (non-empty) when `kind` is `message`. Optional for `tour_request`. Max ' +
          `${MESSAGE_MAX_LENGTH} characters.`,
      ),
    consentTextVersion: consentTextVersionSchema
      .optional()
      .describe(
        'Required for new clients (#631). The consent text version the consumer saw. An older ' +
          'client may omit it, and the server then records `v1`. The server stores the text ' +
          'for the version, never a client string. Needs `consentToContact` true.',
      ),
    consentChannels: z
      .array(consentChannelSchema)
      .min(1)
      .max(CONSENT_CHANNELS.length)
      .optional()
      .describe(
        'The channels the consumer agreed to. Defaults to the channels that match the ' +
          'supplied `email` and `phone`. `phone_call` and `phone_text` need a `phone`. Only valid when `consentToContact` is true.',
      ),
    consentToContact: z
      .boolean()
      .default(false)
      .describe(
        'Whether the consumer asked to also be connected with a Real Broker, LLC agent. ' +
          'Defaults to false and is never inferred. Routing to the listing agent happens ' +
          'regardless of this value — consent adds a recipient, it never replaces one.',
      ),
  })
  .superRefine((value, ctx) => {
    if (
      (value.consentTextVersion !== undefined || value.consentChannels !== undefined) &&
      !value.consentToContact
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '"consentTextVersion" and "consentChannels" need "consentToContact" true.',
        path: ['consentToContact'],
      });
    }
    if (new Set(value.consentChannels).size !== (value.consentChannels?.length ?? 0)) {
      ctx.addIssue({
        code: 'custom',
        message: '"consentChannels" must not repeat a channel.',
        path: ['consentChannels'],
      });
    }
    for (const channel of value.consentChannels ?? []) {
      const needsPhone = channel !== 'email';
      if (needsPhone && value.phone === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `Channel "${channel}" needs "phone".`,
          path: ['consentChannels'],
        });
      }
    }
    if (value.kind === 'message' && (value.message === undefined || value.message.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: '"message" is required and must not be empty when "kind" is "message".',
        path: ['message'],
      });
    }
  });

export type ListingInquiryRequest = z.output<typeof listingInquiryRequestSchema>;

/** The only thing the response carries — the ticket's own floor: "returns the created id". */
export const listingInquiryResponseSchema = z.object({ id: idSchema });
export type ListingInquiryResponse = z.infer<typeof listingInquiryResponseSchema>;
