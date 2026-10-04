import type { DeliveryMessage } from './channel';

/** One claimed inquiry plus the listing context the intake team needs. */
export interface InquiryForDelivery {
  id: string;
  listing_id: string;
  kind: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  created_at: Date;
  /** From `listing_search_v`, which already masks it. Null when the listing is not publishable. */
  address: string | null;
  address_display_allowed: boolean | null;
}

const KIND_LABEL: Record<string, string> = {
  message: 'Message to a buyer agent',
  tour_request: 'Tour request',
};

/**
 * Builds the intake message. The consumer's text passes through as written.
 * The address appears only when `address_display_allowed` is true (PRD §6). The recipient is
 * `intakeAddress`, never a value from the request or the listing.
 */
export function buildIntakeMessage(
  inquiry: InquiryForDelivery,
  options: { intakeAddress: string; fromAddress: string; siteOrigin: string | null },
): DeliveryMessage {
  const kindLabel = KIND_LABEL[inquiry.kind] ?? inquiry.kind;
  const lines: string[] = [
    'New buyer-agent request for Cribstop intake.',
    '',
    `Request type: ${kindLabel}`,
    `Received: ${inquiry.created_at.toISOString()}`,
    `Inquiry ID: ${inquiry.id}`,
    '',
    `Listing ID: ${inquiry.listing_id}`,
  ];
  if (options.siteOrigin !== null) {
    lines.push(`Listing link: ${options.siteOrigin}/listing/${inquiry.listing_id}`);
  }
  if (inquiry.address_display_allowed === true && inquiry.address) {
    lines.push(`Listing address: ${inquiry.address}`);
  }
  lines.push(
    '',
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Phone: ${inquiry.phone ?? 'Not provided'}`,
    '',
    'Message:',
    inquiry.message ?? '(none)',
    '',
    'Cribstop is brokered by Real Broker, LLC.',
  );

  return {
    to: options.intakeAddress,
    from: options.fromAddress,
    replyTo: inquiry.email,
    subject: `Cribstop buyer-agent request: ${kindLabel} (${inquiry.id})`,
    textBody: lines.join('\n'),
    tag: 'buyer-agent-intake',
    metadata: { inquiryId: inquiry.id, listingId: inquiry.listing_id, kind: inquiry.kind },
  };
}
