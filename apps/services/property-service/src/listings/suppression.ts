import type { ListingCardRow, ListingDetail, Media } from '@cribstop/property-contracts';

/**
 * The ONE rule for media on an address-suppressed listing, written once and applied by both of the
 * exported functions below (#105).
 *
 * `alt_text` is feed-authored free text on a table BOTH endpoints read through their own LATERAL
 * joins, never through `listing_search_v` — so it is unreachable from the view for exactly the
 * reason `openHouses[].remarks` is. MLS photo captions routinely carry the street line ("Front
 * elevation, 123 Maple St"), and the client renders it as the image's accessible name
 * (`ListingImage.tsx`, `PropertyGallery.tsx`), so leaving it alone publishes the withheld address
 * on screen, in page source, and to screen readers.
 *
 * **Nulled, not substituted — the opposite call from #59's `title`, and for a stated reason.** The
 * contract declares `altText: z.string().nullable()`, so null is a supported wire state rather than
 * a `.parse()` 500, and the client already falls back to `alt=""`. A neutral derived alternative
 * was rejected: anything this service could synthesise would purport to describe an image it has
 * never seen, which is a fabricated fact (PRD §6.3), and the accessible context a gallery needs —
 * the listing's title, price and location — is on the page already. `title` had to be substituted
 * only because `z.string()` is non-nullable and a card with no title does not render; that
 * constraint does not exist here, so the honest answer is available and is the one taken.
 *
 * The `url` is deliberately kept: an image URL is not the address, and withholding the photos would
 * remove the listing from the market rather than mask an address — the same reasoning that keeps
 * the open-house TIMES.
 */
function withheldAltText<T extends Media>(media: T): T {
  return { ...media, altText: null };
}

/**
 * THE address-suppression boundary for the CARD response (#105, #153).
 *
 * Until now the card path had no response boundary at all: `searchListings()` relied entirely on
 * `listing_search_v`, which is correct for every field the view projects and silently wrong for the
 * ones it does not — `primaryMedia` and `openHouse.remarks`, both joined in from tables the view
 * never touches. Introduced as a sibling of `applyAddressSuppression()` in this same file, keyed on
 * the same signal and applied at the same edge of `repository.ts`, so the two paths stay one
 * mechanism rather than becoming two places to remember.
 *
 * `openHouse.remarks` is defended here as well as by the view's `CASE WHEN
 * address_display_allowed` (migration `1785801600011`). That CASE expression has been rewritten
 * three times already (migrations 009, 010, 011); this boundary layer is the net beneath it, the
 * same defence-in-depth the detail path already has (#59).
 */
export function applyCardAddressSuppression(card: ListingCardRow): ListingCardRow {
  if (card.address !== null) {
    return card;
  }
  return {
    ...card,
    primaryMedia: card.primaryMedia === null ? null : withheldAltText(card.primaryMedia),
    openHouse: card.openHouse === null ? null : { ...card.openHouse, remarks: null },
  };
}

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
 * Three things live outside the view and therefore here:
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
 *  - **`listing.media[].altText` (#105).** The detail query builds `media[]` from its own `json_agg`
 *    over `listing_media`, another query that never passes through the view. See
 *    `withheldAltText()` above for why it is nulled rather than substituted.
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
      media: detail.listing.media.map(withheldAltText),
      openHouses: detail.listing.openHouses.map((openHouse) => ({
        ...openHouse,
        remarks: null,
      })),
    },
  };
}
