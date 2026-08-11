import { Amenity, ListingSource, ListingStatus, ListingType, PropertyType } from './constants';

/**
 * Shape of one entry in the frontend mock dataset
 * (`apps/clients/cribstop/next/src/lib/listings.ts`), trimmed to the fields
 * the seed transform needs. Field names/casing mirror the frontend `Listing`
 * interface (`apps/clients/cribstop/next/src/lib/types.ts`).
 *
 * Note this is the CONSUMER shape, which is deliberately flat. The database is not: facts are stored at
 * the level whose lifetime they share (see the migrations), and `transform.ts` is where the flat entry
 * is decomposed into community / property / unit / listing rows.
 */
export interface MockListing {
  id: string;
  title: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  neighborhood: string;
  price: number;
  status: ListingStatus;
  listingType: ListingType;
  source: ListingSource;
  propertyType: PropertyType;
  beds: number;
  baths: number;
  sqft: number;
  lotSqft?: number;
  yearBuilt?: number;
  imageUrls: string[];
  brokerName: string;
  brokerPhone: string;
  brokerEmail: string;
  officeName: string;
  officeBrokerLeadPhone?: string;
  officeBrokerLeadMail?: string;
  lastUpdated: string;
  description: string;
  amenities: string[];
  latitude: number;
  longitude: number;
  featured: boolean;
  /**
   * A single open house in the consumer shape. The database models open houses as their own multi-row
   * child table, so this maps to zero or one `listing_open_houses` row — a listing with two weekends of
   * showings is representable in the schema even though this mock shape cannot express it.
   */
  openHouse?: { date: string; startTime: string; endTime: string } | null;
  priceReduced?: boolean;
  newConstruction?: boolean;
  /** Sale price, for a listing that has already closed. Requires `closeDate`. */
  closePrice?: number;
  /** Close date, required for a sold listing to be publicly displayable (Bright solds-display policy). */
  closeDate?: string;
}

export interface CommunityRow {
  id: string;
  name: string;
  is_sample: boolean;
}

/**
 * The durable physical home. Holds site facts AND — when the property is not subdivided — the dwelling
 * facts (beds/baths/living area) that used to live only on the transient listing.
 */
export interface PropertyRow {
  id: string;
  community_id: string | null;
  address_raw: string;
  street_line: string;
  city: string;
  state: string;
  zip5: string;
  address_key: string;
  latitude: number | null;
  longitude: number | null;
  neighborhood: string | null;
  property_type: PropertyType;
  year_built: number | null;
  lot_sqft: number | null;
  beds: number | null;
  baths_full: number | null;
  baths_half: number | null;
  living_sqft: number | null;
  is_sample: boolean;
}

/** An optional subdivision of a property. Absent for single-family homes and townhomes. */
export interface UnitRow {
  id: string;
  property_id: string;
  unit_number: string | null;
  floor: number | null;
  beds: number | null;
  baths_full: number | null;
  baths_half: number | null;
  living_sqft: number | null;
  is_sample: boolean;
}

/**
 * One offer. Everything here is either an offer fact or a deliberate write-time snapshot of the
 * dwelling facts resolved from properties/units — see `upsertListing()`, the only writer.
 */
export interface ListingRow {
  id: string;
  property_id: string;
  unit_id: string | null;
  title: string;
  offer_kind: OfferKind;
  consumer_status: ListingStatus | null;
  status: string;
  source: ListingSource;
  list_price: number;
  close_price: number | null;
  close_date: string | null;
  // Dwelling snapshot
  beds: number | null;
  baths_full: number | null;
  baths_half: number | null;
  living_sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  neighborhood: string | null;
  city: string;
  state: string;
  zip5: string;
  latitude: number | null;
  longitude: number | null;
  // Copy
  description: string | null;
  description_source: DescriptionSource | null;
  amenities: Amenity[];
  /**
   * Moderation state for `description`. **Required, not optional.** The column has a DB default of
   * `'approved'`, and an optional field here would let an MLS mapper omit it and thereby publish
   * unreviewed third-party remarks as approved copy — the exact failure the moderation state exists
   * to prevent. Stating it is cheap; forgetting it must not be possible.
   */
  description_moderation: DescriptionModeration;
  // Merchandising
  featured: boolean;
  /**
   * Why this listing is featured. `featured` was already writable while this was not, which is the
   * real defect: a row could rank first under `recommended` with no recordable reason, and paid
   * placement with no disclosure is an FTC / PRD §6 failure. `sponsored` on the wire is derived
   * from `featured_reason = 'paid'`, so the disclosure is only renderable if this is written.
   */
  featured_reason: FeaturedReason | null;
  price_reduced: boolean;
  new_construction: boolean;
  /**
   * RESO `InternetEntireListingDisplayYN` — the seller withheld the WHOLE listing.
   * **Required, not optional**, for the same reason as `description_moderation` and more urgently:
   * both columns default to `true` in the database, so an optional field lets a feed mapper that
   * forgets to map the flag publish a listing the seller opted out of, silently and with no error.
   * `listing_search_v` enforces the consequence; this is where the fact has to arrive intact.
   */
  internet_display_allowed: boolean;
  /** RESO `InternetAddressDisplayYN` — the seller withheld the street address (and, with it, the
   *  coordinates, which the view masks together because the point re-identifies the address). */
  address_display_allowed: boolean;
  // Attribution
  broker_name: string;
  broker_phone: string;
  broker_email: string;
  office_name: string;
  office_broker_lead_phone: string | null;
  office_broker_lead_email: string | null;
  listing_agent_name: string | null;
  is_sample: boolean;
  last_updated: string;
}

export interface OpenHouseRow {
  id: string;
  listing_id: string;
  starts_at: string;
  ends_at: string;
  /**
   * Consumer-visible showing copy. It was previously absent from both this type and the INSERT, so
   * `openHouse.remarks` — a field the wire contract declares — could never be anything but null no
   * matter what the feed sent.
   */
  remarks: string | null;
  /**
   * A cancelled occurrence must not light the "Open house" badge. `listing_search_v` filters on this
   * column, so leaving it unwritable meant the filter had nothing to exclude and could not be tested
   * against a row that actually exercised it.
   */
  is_cancelled: boolean;
  is_sample: boolean;
}

export interface MediaRow {
  id: string;
  listing_id: string;
  source_url: string;
  sort_order: number;
  is_primary: boolean;
  is_sample: boolean;
}

export type OfferKind = 'sale' | 'rent';
export type DescriptionSource = 'mls_remarks' | 'agent' | 'internal';
/** Mirrors the CHECK on `listings.description_moderation`. */
export type DescriptionModeration = 'pending' | 'approved' | 'suppressed';
/** Mirrors the CHECK on `listings.featured_reason`. Editorial and algorithmic placement are ordinary
 *  product; `paid` is what requires a Sponsored disclosure at render time. */
export type FeaturedReason = 'editorial' | 'algorithmic' | 'paid';
