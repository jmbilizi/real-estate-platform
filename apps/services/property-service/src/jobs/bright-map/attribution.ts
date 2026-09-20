/**
 * NAR 7.58 attribution mapping (#93, #33 item 8(c)).
 *
 * Bright's IDX tier exposes no field distinct from the listing office for "the broker" — there is no
 * `BrokerName`/`BrokerPhone`/`BrokerEmail`. `ListOfficeName`/`ListOfficePhone`/`ListOfficeEmail` are
 * the listing firm's contact record, so they fill `listings.broker_*` and `office_name` alike. A
 * record missing any of the three fails closed: no attribution, no publish.
 */

export interface AttributionFields {
  readonly brokerName: string;
  readonly brokerPhone: string;
  readonly brokerEmail: string;
  readonly officeName: string;
  readonly officeBrokerLeadPhone: string | null;
  readonly officeBrokerLeadEmail: string | null;
  readonly listingAgentName: string | null;
}

export type AttributionResult =
  | { readonly ok: true; readonly fields: AttributionFields }
  | { readonly ok: false; readonly reason: 'missing_required_attribution' };

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function mapAttribution(payload: Readonly<Record<string, unknown>>): AttributionResult {
  const officeName = nonBlank(payload.ListOfficeName);
  const officePhone = nonBlank(payload.ListOfficePhone);
  const officeEmail = nonBlank(payload.ListOfficeEmail);
  if (!officeName || !officePhone || !officeEmail) {
    return { ok: false, reason: 'missing_required_attribution' };
  }
  return {
    ok: true,
    fields: {
      brokerName: officeName,
      brokerPhone: officePhone,
      brokerEmail: officeEmail,
      officeName,
      // Bright carries the agent's own office line, not a separate "broker lead" contact. It is the
      // closest available fit and optional on the DB side, so a missing value stays null rather than
      // falling back to the office's own number twice.
      officeBrokerLeadPhone: nonBlank(payload.ListAgentOfficePhone),
      officeBrokerLeadEmail: null,
      listingAgentName: nonBlank(payload.ListAgentFullName),
    },
  };
}
