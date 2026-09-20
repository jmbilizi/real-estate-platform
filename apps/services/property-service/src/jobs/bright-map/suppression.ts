/**
 * Fail-closed seller display suppression mapping (#93).
 *
 * Two RESO booleans are licensed for mapping (#33 item 9): `InternetEntireListingDisplayYN` and
 * `InternetAddressDisplayYN`. Anything other than the literal `true` — missing, `false`, a string,
 * a stray `"Y"` this feed has never actually sent — is treated as withholding, never as permitting.
 *
 * The `#53` field-level flags (price, price history, media, days-on-market) are NOT mapped from any
 * Bright field: #146 blocks mapping any Bright field to these until Bright supplies the semantics in
 * writing. So every Bright row carries them fixed to suppressed. This is a deliberate fail-closed
 * mapping, not an omission — lifting it is a #146 decision, not a change here.
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
    // #146: fixed suppressed until Bright's semantics are in writing.
    priceDisplayAllowed: false,
    priceHistoryDisplayAllowed: false,
    mediaDisplayAllowed: false,
    daysOnMarketDisplayAllowed: false,
  };
}
