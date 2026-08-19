import type { ListingDetail } from '@cribstop/property-contracts';

/**
 * THE address-suppression boundary for the detail response. One named function at the response
 * edge, for the same reason the sold gate is one function.
 *
 * Everything here exists because `listing_search_v` structurally CANNOT reach it. The view is the
 * enforcement point for the display rules and nothing below re-implements one of its predicates —
 * the signal this function keys off is `listing.address === null`, i.e. the OUTCOME the view already
 * decided, never `address_display_allowed`, which this service deliberately never reads (see
 * `FORBIDDEN_COLUMNS`).
 *
 * Two things live outside the view and therefore here:
 *
 *  - **`unit.unitNumber`.** The view masks the address and builds it as
 *    `street_line || ' ' || unit_number`, but the unit number itself lives on `units`, which the
 *    detail query joins separately. Publishing it beside `property.city/state/zip` hands back most
 *    of the address the seller opted out of.
 *  - **`listing.openHouses[].remarks` (#59).** The view masks the ONE upcoming occurrence it
 *    projects, but `getListingById()` builds the full `openHouses[]` array from its own `json_agg`
 *    over `listing_open_houses` — a query that never passes through the view at all. Open-house
 *    remarks routinely name cross streets and house numbers ("entrance at the rear of 142, park on
 *    Oak"), so leaving that array alone would have let the detail endpoint publish, verbatim, the
 *    street line the view had just masked three fields above it.
 *
 * The occurrence TIMES are deliberately kept: a time does not identify an address, and withholding
 * a showing a consumer can attend removes inventory from the market rather than masking it. The
 * opt-out is a mask on display, not a removal.
 */
export function applyAddressSuppression(detail: ListingDetail): ListingDetail {
  if (detail.listing.address !== null) {
    return detail;
  }

  return {
    ...detail,
    // A non-subdivided home has no unit at all; `unit: null` means "the offer is the whole
    // property", never "unknown", so there is nothing to mask.
    unit: detail.unit === null ? null : { ...detail.unit, unitNumber: null },
    listing: {
      ...detail.listing,
      openHouses: detail.listing.openHouses.map((openHouse) => ({
        ...openHouse,
        remarks: null,
      })),
    },
  };
}
