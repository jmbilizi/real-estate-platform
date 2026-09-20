/**
 * NAR 7.58 attribution mapping (#93, #33 item 8(c)).
 *
 * Bright's IDX tier exposes no field distinct from the listing office for "the broker" — there is no
 * `BrokerName`/`BrokerPhone`/`BrokerEmail`. `ListOfficeName`/`ListOfficePhone`/`ListOfficeEmail` are
 * the listing firm's contact record, so they fill `listings.broker_*` and `office_name` alike. A
 * record missing the office name fails closed: no attribution, no publish.
 *
 * On the live test feed (#207), `ListOfficePhone` is blank on 21% of records even when
 * `ListOfficeName` is present. `ListAgentOfficePhone` is a genuine office line (the agent's own desk
 * at that brokerage, per the comment on `officeBrokerLeadPhone` below), so it is a sound fallback.
 * `ListAgentDirectPhone`/`ListAgentPreferredPhone` and `ListAgentEmail` are deliberately NOT in the
 * chain: `AttributionFields` has no "agent's personal contact" field distinct from `brokerPhone`/
 * `brokerEmail`, so publishing an individual's direct line or mobile there would present it to a
 * consumer as the brokerage's own contact. NAR 7.58 and PRD §6.2 require the brokerage be
 * identifiable, not merely that some reachable number exists, and an agent's personal number
 * published under the office's identity is both a misattribution and a privacy exposure this
 * mapper would have created. `ListOfficeEmail` has no fallback for the same reason: nothing else in
 * this entity is an office-level email address.
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
  const officePhone = nonBlank(payload.ListOfficePhone) ?? nonBlank(payload.ListAgentOfficePhone);
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
