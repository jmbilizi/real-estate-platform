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
export const CONSENT_DISCLOSURE_TEXT =
  "I agree that Real Broker, LLC (Cribstop's brokerage) and its agents may contact me about this " +
  'home by phone, text message, or email, including by autodialer or prerecorded message. ' +
  'Consent is not required to use Cribstop, and message and data rates may apply.';

/**
 * The request body for `POST /listings/{id}/inquiries`.
 *
 * `.strictObject()`: an unknown field is rejected outright, which is the Fair Housing guardrail
 * this schema exists to enforce (PRD §6, #34) — there is no age, household size, occupancy,
 * familial status or disability field to strip, because none can ever be added without a
 * reviewed schema change reaching this file first.
 *
 * `name`/`email` are required regardless of sign-in state. Signed-in resolves an account id
 * server-side (#86); it does not excuse the caller from submitting contact details, because the
 * inquiry must remain readable on its own even if the account is later deleted.
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
