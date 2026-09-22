/**
 * Fail-closed seller display suppression mapping (#93).
 *
 * Two RESO booleans are licensed for mapping (#33 item 9): `InternetEntireListingDisplayYN` and
 * `InternetAddressDisplayYN`. Anything other than the literal `true` — missing, `false`, a string,
 * a stray `"Y"` this feed has never actually sent — is treated as withholding, never as permitting.
 *
 * Three of the four `#53` field-level flags — price, price history and days-on-market — are NOT
 * mapped from any Bright field. #146 blocks mapping any Bright field to them until Bright supplies
 * the semantics in writing (#33 item 8(f)). So every Bright row carries those three fixed to
 * suppressed. This is a deliberate fail-closed mapping, not an omission. Lifting any of the three
 * is a #146 decision, not a change here.
 *
 * ## Media is the one exception (stakeholder ruling 2026-09-22, #191)
 *
 * `mediaDisplayAllowed` was fixed to false by the same #146 hold. It is now fixed to true. The
 * stakeholder states that Bright images arrive already carrying their trademark or watermark, and
 * that Cribstop holds a licence to display them. The ruling is recorded on #146 and on #33.
 *
 * It supersedes the #146 hold FOR MEDIA ONLY. Read that narrowly. The ruling answers one question —
 * may we display a Bright photo — and answers nothing about price, price history or days on market,
 * which stay suppressed above. Widening it needs another ruling, not a reading of this one.
 *
 * Two limits are worth stating, because the flag alone looks more permissive than it is.
 *
 *  - This is the LISTING-level gate that `repository.ts` reads as
 *    `(v.media_display_allowed OR m.retained_when_suppressed)`. True here means "a Bright listing's
 *    photos may be selected normally". It is not a per-photo permission.
 *  - `retained_when_suppressed` stays unset by this mapper. That marker is #146's mechanism for the
 *    single retained photo of a media-suppressed listing, and it still waits on 8(f). Nothing here
 *    substitutes for it.
 *
 * The ruling rests on an asserted existing licence, not on written terms. #33 item 8(c) still owes
 * the photo usage, retention and attribution terms in writing.
 */

export interface SuppressionFlags {
  readonly internetDisplayAllowed: boolean;
  readonly addressDisplayAllowed: boolean;
  readonly priceDisplayAllowed: boolean;
  readonly priceHistoryDisplayAllowed: boolean;
  readonly mediaDisplayAllowed: boolean;
  readonly daysOnMarketDisplayAllowed: boolean;
}

function isExplicitlyTrue(value: unknown): boolean {
  return value === true;
}

export function mapSuppressionFlags(payload: Readonly<Record<string, unknown>>): SuppressionFlags {
  return {
    internetDisplayAllowed: isExplicitlyTrue(payload.InternetEntireListingDisplayYN),
    addressDisplayAllowed: isExplicitlyTrue(payload.InternetAddressDisplayYN),
    // #146: fixed suppressed until Bright's semantics are in writing (#33 item 8(f)).
    priceDisplayAllowed: false,
    priceHistoryDisplayAllowed: false,
    // Stakeholder ruling 2026-09-22 (#191). Media only — see the header. Fixed true, not read from
    // a feed field: no Bright field for this is confirmed, so a field-derived value would be a
    // guess wearing the clothes of a mapping.
    mediaDisplayAllowed: true,
    daysOnMarketDisplayAllowed: false,
  };
}
