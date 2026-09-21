import type { InquiryKind } from '@cribstop/property-contracts';
import { CONSENT_DISCLOSURE_TEXT } from '@cribstop/property-contracts';

/**
 * THE ONLY MODULE THAT WRITES `listing_inquiries` (#131), mirroring `src/db/write.ts`'s rule for
 * `listings`: one writer, so the consent-triad invariant (all three of `consentToContact`,
 * `consent_disclosure_text` and `consent_given_at`, or none) is decided in exactly one place.
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface CreateListingInquiryInput {
  listingId: string;
  kind: InquiryKind;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  /** Resolved via account-service's credential introspection (#86). `null` when signed out. */
  accountId: string | null;
  consentToContact: boolean;
}

/**
 * Inserts one inquiry and returns its id.
 *
 * The disclosure text is never taken from the caller — it is this constant, the exact sentence
 * `#132`'s consent checkbox renders, so the persisted record and the wire copy cannot drift. A
 * caller-supplied "what I was shown" string would be a compliance record an attacker could
 * falsify.
 */
export async function createListingInquiry(
  client: Queryable,
  input: CreateListingInquiryInput,
): Promise<string> {
  const consentDisclosureText = input.consentToContact ? CONSENT_DISCLOSURE_TEXT : null;

  const result = await client.query<{ id: string }>(
    `INSERT INTO listing_inquiries
       (listing_id, kind, name, email, phone, message, account_id,
        consent_to_contact, consent_disclosure_text, consent_given_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $8 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      input.listingId,
      input.kind,
      input.name,
      input.email,
      input.phone,
      input.message,
      input.accountId,
      input.consentToContact,
      consentDisclosureText,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('INSERT INTO listing_inquiries returned no row.');
  }
  return row.id;
}
