import { BRAND } from '@/lib/brand';
import { formatListingLocation, formatStreetAddress } from '@/lib/listing-format';

/**
 * The share payload for one listing, and the metadata a shared link unfurls into.
 *
 * A share is a publication. Everything a listing page must not say, a share must not say either,
 * and the two must not disagree — so both the button and `generateMetadata` compose their text
 * here, exactly once.
 *
 * Three rules hold this file together:
 *
 * 1. **Suppression is the service's decision, never re-derived here.** `applyAddressSuppression`
 *    and `applyCardAddressSuppression` already nulled `address`, `latitude`, `longitude` and
 *    `unitNumber` for a seller who opted out of address display, and nulled `price` for a withheld
 *    price. This file reads those nulls through `formatStreetAddress` and `formatListingPrice`,
 *    which is where each rule has its single implementation.
 * 2. **Never `title` and never `description`.** Address suppression does not reach the free-text
 *    `title` or `description` (an open server-side gap, #59), and a real feed routinely puts the
 *    street line in both. Putting either in a share title or an `og:description` would hand back
 *    the address the seller withheld — to a preview card that gets cached and re-posted.
 * 3. **Never claim provenance a row does not have.** A `isSample` row is labelled as sample data, a
 *    `sponsored` row is labelled as a paid placement, and no share text asserts MLS provenance.
 *    Per-listing attribution is the row's own `listedBy` — the listing office is a third party on
 *    a `brightMLS` row, so "brokered by Real Broker, LLC" describes the site and never the home.
 */

/** The fields a share reads. A subset of `ListingDetailView`, so a card row can share too. */
export interface ShareableListing {
  id: string;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  neighborhood: string | null;
  isSample: boolean;
  sponsored: boolean;
  /** NAR 7.58 attribution, derived server-side. Rendered as-is on every surface that shows a row. */
  listedBy: string;
}

/** The label a sample row carries on every surface it appears on, this one included (PRD §6.3). */
export const SAMPLE_SHARE_LABEL = 'Sample data — an illustration, not real listing inventory.';

/** The paid-placement disclosure, owed wherever a sponsored row renders (FTC / PRD §6). */
export const SPONSORED_SHARE_LABEL = 'Sponsored listing.';

/**
 * The required labels for a row, in the order a truncating preview should keep them.
 *
 * Every unfurl surface cuts the tail of a description, so a disclosure placed last is the first
 * thing lost. These lead.
 */
export function shareDisclosures(listing: ShareableListing): string[] {
  return [
    ...(listing.isSample ? [SAMPLE_SHARE_LABEL] : []),
    ...(listing.sponsored ? [SPONSORED_SHARE_LABEL] : []),
  ];
}

/**
 * The canonical path for a listing.
 *
 * `/listing/<id>` is the hard-navigation route, which server-renders the listing into the first
 * HTML. It is deliberately not `location.pathname`: a card click opens the panel as client state
 * and pushes this URL with `history.pushState`, but the address bar can still be a search URL, and
 * sharing that sends a recipient to a result set rather than to the home.
 */
export function listingPath(id: string): string {
  return `/listing/${encodeURIComponent(id)}`;
}

/** The absolute canonical URL, resolved against the origin the reader is on. */
export function listingShareUrl(id: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}${listingPath(id)}`;
}

/**
 * The heading a share may use — the street address, or the neighbourhood when the address is
 * masked. It is the same expression the detail page's `<h1>` renders, so a share can never name a
 * home more precisely than its own page does.
 */
export function shareHeading(listing: ShareableListing): string {
  return (
    formatStreetAddress(listing.address, listing.city, listing.state, listing.zip) ??
    formatListingLocation(listing.neighborhood, listing.city, listing.state)
  );
}

export interface ListingSharePayload {
  title: string;
  text: string;
  url: string;
}

/** The payload handed to `navigator.share`. */
export function buildListingShare(listing: ShareableListing, url: string): ListingSharePayload {
  const heading = shareHeading(listing);

  return {
    title: shareTitle(listing),
    text: [
      ...shareDisclosures(listing),
      `${heading}.`,
      `Listed by ${listing.listedBy}.`,
      `From ${BRAND.brokerage} on ${BRAND.siteDomain}.`,
    ].join(' '),
    url,
  };
}

/**
 * The share-sheet and preview-card title.
 *
 * The sample label belongs here and not only in the body text: a share sheet and a compact unfurl
 * both show the title alone, so a label that lives only in the description is a label a recipient
 * may never see.
 */
export function shareTitle(listing: ShareableListing): string {
  const heading = shareHeading(listing);
  return listing.isSample ? `Sample listing — ${heading}` : heading;
}
