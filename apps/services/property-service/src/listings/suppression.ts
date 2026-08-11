import type { ListingDetail } from '@cribstop/property-contracts';

/**
 * THE address-suppression boundary for the detail response. One named function at the response
 * edge, for the same reason the sold gate is one function.
 *
 * `listing_search_v` masks the address and the coordinates together, but the unit number lives on
 * `units` and the view builds the address as `street_line || ' ' || unit_number`. So publishing
 * `unit.unitNumber` beside `property.city/state/zip` on a suppressed condo hands back most of the
 * address the seller opted out of. A null address is the signal — not the flag behind it, which
 * this service deliberately never reads (see FORBIDDEN_COLUMNS).
 */
export function applyAddressSuppression(detail: ListingDetail): ListingDetail {
  if (detail.listing.address !== null || detail.unit === null) {
    return detail;
  }
  return { ...detail, unit: { ...detail.unit, unitNumber: null } };
}
