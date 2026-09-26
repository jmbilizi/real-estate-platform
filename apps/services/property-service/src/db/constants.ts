/**
 * Enum-like value lists shared by the schema (CHECK constraints), the Bright MLS mapper
 * (`src/jobs/bright-map/`), and (eventually) request validation in the search/detail service (#22).
 *
 * Kept in lockstep with the consumer web app's shapes:
 * `apps/clients/cribstop/next/src/lib/types.ts`.
 */

export const AMENITIES = [
  'Pool',
  'Garage',
  'Gym',
  'Elevator',
  'Balcony',
  'Fireplace',
  'Washer/Dryer',
  'Pet Friendly',
  'Waterfront',
  'Office',
  'Rooftop',
  'Garden',
  'Smart Home',
  'Solar',
  'EV Charging',
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const PROPERTY_TYPES = [
  'Single Family',
  'Condo',
  'Townhome',
  'Multi-Family',
  'Loft',
  'Land',
  'New Construction',
  'Manufactured/Mobile',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * The consumer-facing union the web client publishes. `sold` is a lifecycle state wearing the costume
 * of a type, which is why the database does NOT store this: `listings.offer_kind` holds the durable
 * kind ('sale' | 'rent') and `listings.listing_type` is a generated column projecting this 3-value
 * union from offer_kind + status, so the two can never contradict each other. Before, both
 * 'sale' + Sold and 'sold' + Active were representable, and a sold RENTAL was not representable at all.
 */
export const LISTING_TYPES = ['sale', 'rent', 'sold'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

/** What the database stores: the durable nature of the offer, independent of its lifecycle. */
export const OFFER_KINDS = ['sale', 'rent'] as const;

/**
 * Maps a consumer status onto the feed status code stored in `listings.status` (FK to
 * `listing_statuses`). 'Sold' is our consumer label; 'Closed' is the RESO/Bright value, and the lookup
 * table holds the full feed vocabulary so a real 'Withdrawn' or 'Expired' does not violate a constraint.
 */
export const CONSUMER_STATUS_TO_FEED_STATUS: Record<ListingStatus, string> = {
  Active: 'Active',
  Pending: 'Pending',
  'Coming Soon': 'Coming Soon',
  Sold: 'Closed',
};

export const LISTING_SOURCES = ['brightMLS', 'internal', 'other'] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

export const LISTING_STATUSES = ['Active', 'Pending', 'Coming Soon', 'Sold'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];
