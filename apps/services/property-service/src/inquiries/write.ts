import type { ConsentChannel, ConsentTextVersion, InquiryKind } from '@cribstop/property-contracts';
import { CONSENT_TEXTS, CURRENT_CONSENT_TEXT_VERSION } from '@cribstop/property-contracts';

/**
 * THE ONLY MODULE THAT INSERTS `listing_inquiries` (#131). Delivery-state updates (#134) live in
 * `delivery/store.ts`. Status changes live in `lead-status-write.ts`. Mirrors `src/db/write.ts`'s
 * rule for `listings`: one writer, so the consent invariants are decided in exactly one place.
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface CreateListingInquiryInput {
  listingId: string;
  kind: InquiryKind;
  /** The confirmed account email. Written to the `email` column, and to `name` until #691 drops it. */
  contactEmail: string;
  phone: string | null;
  message: string | null;
  /** Resolved via account-service's credential introspection (#86). */
  accountId: string;
  consentToContact: boolean;
  /** Ignored unless `consentToContact`. Defaults to the current version. */
  consentTextVersion?: ConsentTextVersion;
  /** Ignored unless `consentToContact`. Defaults to email, plus phone call and text when a phone is given. */
  consentChannels?: readonly ConsentChannel[];
}

function defaultConsentChannels(phone: string | null): ConsentChannel[] {
  return ['email', ...(phone ? (['phone_call', 'phone_text'] as const) : [])];
}

/**
 * Inserts one inquiry and its creation event (`NULL` -> `new`, actor `system`) in ONE statement,
 * so both commit or neither does. Returns the inquiry id.
 *
 * The disclosure text is never taken from the caller. It is the text the server holds for the
 * version, so the stored record and the wire copy cannot drift. A caller-supplied "what I was
 * shown" string would be a compliance record an attacker could falsify.
 */
export async function createListingInquiry(
  client: Queryable,
  input: CreateListingInquiryInput,
): Promise<string> {
  const version = input.consentToContact
    ? (input.consentTextVersion ?? CURRENT_CONSENT_TEXT_VERSION)
    : null;
  const consentDisclosureText = version ? CONSENT_TEXTS[version] : null;
  const channels = input.consentToContact
    ? [...(input.consentChannels ?? defaultConsentChannels(input.phone))]
    : null;

  const result = await client.query<{ id: string }>(
    `WITH inserted AS (
       INSERT INTO listing_inquiries
         (listing_id, kind, name, email, phone, message, account_id, verified_account,
          consent_to_contact, consent_disclosure_text, consent_given_at,
          consent_text_version, consent_channels)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN $9 THEN now() ELSE NULL END, $11, $12)
       RETURNING id
     ), event AS (
       INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
       SELECT id, NULL, 'new', 'system' FROM inserted
     )
     SELECT id FROM inserted`,
    [
      input.listingId,
      input.kind,
      input.contactEmail,
      input.contactEmail,
      input.phone,
      input.message,
      input.accountId,
      true,
      input.consentToContact,
      consentDisclosureText,
      version,
      channels,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('INSERT INTO listing_inquiries returned no row.');
  }
  return row.id;
}
