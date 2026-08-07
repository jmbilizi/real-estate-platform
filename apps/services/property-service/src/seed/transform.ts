import {
  AMENITIES,
  Amenity,
  CONSUMER_STATUS_TO_FEED_STATUS,
  SEED_IS_SAMPLE,
  SEED_LISTING_SOURCE,
} from './constants';
import { buildAddressKey, splitUnitDesignator } from './address';
import {
  CommunityRow,
  ListingRow,
  MediaRow,
  MockListing,
  OfferKind,
  OpenHouseRow,
  PropertyRow,
  UnitRow,
} from './types';

/**
 * Pure mapping/validation functions that decompose a mock listing (the frontend's flat `Listing` shape)
 * into rows for `communities` / `properties` / `units` / `listings` and the listing child tables.
 *
 * Free of any I/O (no `pg`, no `crypto.randomUUID()`) so it can be unit-tested without a database — ids
 * are supplied by the caller (`seed.ts`, which generates them and performs the writes).
 *
 * The central rule: a fact is written at the level whose lifetime it shares. Physical facts go to the
 * property (or the unit when the building is subdivided); offer facts go to the listing. The listing's
 * copies of the physical facts are a deliberate snapshot produced by `mapToListingRow`, never an
 * independent source of truth.
 */

/**
 * Validates that every amenity in the input is a member of the fixed Amenity enum (PRD §3.1). Throws on
 * the first unrecognized value so bad mock data fails loudly at seed time instead of silently reaching
 * the DB. The database now enforces the same closed set via a CHECK, so this is defence in depth rather
 * than the only gate — an open amenity/keyword field would be unreviewable Fair Housing copy.
 */
export function validateAmenities(amenities: string[]): Amenity[] {
  const allowed = new Set<string>(AMENITIES);
  const invalid = amenities.filter((amenity) => !allowed.has(amenity));
  if (invalid.length > 0) {
    throw new Error(`Invalid amenity value(s): ${invalid.join(', ')}`);
  }
  return amenities as Amenity[];
}

/**
 * Groups mock listings into synthetic communities keyed by neighborhood + city + state, so listings
 * sharing a neighborhood are seeded under one `communities` row instead of being orphaned.
 */
export function communityKeyFor(listing: MockListing): string {
  return `${listing.neighborhood}|${listing.city}|${listing.state}`;
}

export function communityNameFor(listing: MockListing): string {
  return `${listing.neighborhood}, ${listing.city}`;
}

export function groupListingsByCommunity(listings: MockListing[]): Map<string, MockListing[]> {
  const groups = new Map<string, MockListing[]>();
  for (const listing of listings) {
    const key = communityKeyFor(listing);
    const existing = groups.get(key);
    if (existing) {
      existing.push(listing);
    } else {
      groups.set(key, [listing]);
    }
  }
  return groups;
}

export function mapToCommunityRow(id: string, listing: MockListing): CommunityRow {
  return { id, name: communityNameFor(listing), is_sample: SEED_IS_SAMPLE };
}

/**
 * The mock dataset carries bathrooms as one decimal (2.5). MLS feeds supply full and half counts
 * separately, and a single decimal cannot be decomposed back, so the durable columns are integers and
 * the decimal is a generated column derived from them.
 */
export function splitBaths(baths: number): { baths_full: number; baths_half: number } {
  const full = Math.floor(baths);
  // Anything from .1 to .9 in this dataset means one half bath; there are no quarter baths.
  return { baths_full: full, baths_half: baths - full >= 0.5 ? 1 : 0 };
}

/**
 * Is this listing an offer on the WHOLE property, or on a subdivision of it?
 *
 * Derived from the address's unit designator. Consequence: a property whose address carries no unit
 * designator has NO `units` row (PRD §3 — units are optional), and its dwelling facts live on the
 * property itself. This is why beds/baths finally have a durable home for a single-family house.
 */
export function isSubdivided(listing: MockListing): boolean {
  return splitUnitDesignator(listing.address).unitNumber !== null;
}

export function mapToPropertyRow(
  id: string,
  communityId: string | null,
  listing: MockListing,
): PropertyRow {
  const { streetLine } = splitUnitDesignator(listing.address);
  const zip5 = listing.zip.slice(0, 5);
  const subdivided = isSubdivided(listing);
  const baths = splitBaths(listing.baths);

  return {
    id,
    community_id: communityId,
    // The source string, retained for lineage so address_key can be re-derived if normalisation improves.
    address_raw: listing.address,
    // The unit designator is deliberately NOT here — it belongs to the units row. Storing it in both
    // places is how one building becomes two properties.
    street_line: streetLine,
    city: listing.city,
    state: listing.state,
    zip5,
    address_key: buildAddressKey({ streetLine, state: listing.state, zip5 }),
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,
    // Durable: a neighborhood is a containment fact of the land, never of the offer. Needed on the
    // property so the Verified Resident badge (PRD §3.2/§8) can render at neighborhood level for a home
    // that is not for sale — i.e. without dereferencing the street address.
    neighborhood: listing.neighborhood ?? null,
    property_type: listing.propertyType,
    year_built: listing.yearBuilt ?? null,
    // Lot size belongs to the parcel. For a condo it is common area, so it is never unit-scoped.
    lot_sqft: listing.lotSqft ?? null,
    // Dwelling facts live here only when the property is NOT subdivided; otherwise the unit owns them.
    beds: subdivided ? null : listing.beds,
    baths_full: subdivided ? null : baths.baths_full,
    baths_half: subdivided ? null : baths.baths_half,
    living_sqft: subdivided ? null : listing.sqft,
    is_sample: SEED_IS_SAMPLE,
  };
}

/**
 * Builds a `units` row when the listing's address implies a subdivision of a property (condo /
 * apartment / penthouse). Returns null for a property held as a single dwelling (single-family home,
 * townhome, land) — units stay optional per PRD §3, and no synthetic placeholder row is created.
 */
export function mapToUnitRow(id: string, propertyId: string, listing: MockListing): UnitRow | null {
  const { unitNumber } = splitUnitDesignator(listing.address);
  if (!unitNumber) {
    return null;
  }
  const baths = splitBaths(listing.baths);
  return {
    id,
    property_id: propertyId,
    unit_number: unitNumber,
    floor: null,
    // The unit is the system of record for its own interior facts.
    beds: listing.beds,
    baths_full: baths.baths_full,
    baths_half: baths.baths_half,
    living_sqft: listing.sqft,
    is_sample: SEED_IS_SAMPLE,
  };
}

/** The durable offer kind, independent of lifecycle. A `sold` mock entry is a sale that has closed. */
export function offerKindFor(listing: MockListing): OfferKind {
  return listing.listingType === 'rent' ? 'rent' : 'sale';
}

/**
 * Maps a flat mock entry to a `listings` row.
 *
 * The physical columns here are a SNAPSHOT of what was advertised, resolved from the same source as the
 * property/unit rows. They exist so search stays a single-table indexed query and so a closed listing
 * keeps rendering as it was advertised even after the dwelling is renovated. They are never an override.
 */
export function mapToListingRow(
  id: string,
  propertyId: string,
  unitId: string | null,
  listing: MockListing,
): ListingRow {
  const amenities = validateAmenities(listing.amenities);
  const baths = splitBaths(listing.baths);
  const consumerStatus = listing.status;

  return {
    id,
    property_id: propertyId,
    unit_id: unitId,
    title: listing.title,
    offer_kind: offerKindFor(listing),
    consumer_status: consumerStatus,
    // The feed vocabulary value. 'Sold' is our consumer label; 'Closed' is what RESO/Bright send.
    status: CONSUMER_STATUS_TO_FEED_STATUS[consumerStatus],
    // Seed/dev data must never be represented as MLS-sourced, regardless of what the mock dataset says
    // (PRD §6.2/§6.3) — always force 'internal'.
    source: SEED_LISTING_SOURCE,
    list_price: listing.price,
    close_price: listing.closePrice ?? null,
    close_date: listing.closeDate ?? null,

    // --- Dwelling snapshot ---
    beds: listing.beds,
    baths_full: baths.baths_full,
    baths_half: baths.baths_half,
    living_sqft: listing.sqft,
    lot_sqft: listing.lotSqft ?? null,
    year_built: listing.yearBuilt ?? null,
    neighborhood: listing.neighborhood ?? null,
    city: listing.city,
    state: listing.state,
    zip5: listing.zip.slice(0, 5),
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,

    description: listing.description,
    // Sample copy is authored by us, not lifted from MLS remarks — mislabelling it would assert MLS
    // provenance for text the MLS never supplied.
    description_source: 'internal',
    amenities,
    featured: listing.featured,
    price_reduced: listing.priceReduced ?? false,
    new_construction: listing.newConstruction ?? false,
    broker_name: listing.brokerName,
    broker_phone: listing.brokerPhone,
    broker_email: listing.brokerEmail,
    office_name: listing.officeName,
    office_broker_lead_phone: listing.officeBrokerLeadPhone ?? null,
    office_broker_lead_email: listing.officeBrokerLeadMail ?? null,
    // The listing agent's own identity. The view composes the client's required `listedBy` display
    // string from this plus the office, so there is no stored concatenation to drift.
    listing_agent_name: listing.brokerName,
    // Seeded rows are always sample data and must be labelled (PRD §6.3).
    is_sample: SEED_IS_SAMPLE,
    last_updated: listing.lastUpdated,
  };
}

/**
 * Maps the mock shape's single open house to zero or one `listing_open_houses` row.
 *
 * Times are combined into real instants so "upcoming" is a comparison rather than a string parse — the
 * previous shape stored the times as `text`, which could be neither compared nor indexed.
 */
export function mapToOpenHouseRow(
  id: string,
  listingId: string,
  listing: MockListing,
): OpenHouseRow | null {
  const openHouse = listing.openHouse;
  if (!openHouse) {
    return null;
  }
  return {
    id,
    listing_id: listingId,
    starts_at: combineDateAndTime(openHouse.date, openHouse.startTime),
    ends_at: combineDateAndTime(openHouse.date, openHouse.endTime),
    is_sample: SEED_IS_SAMPLE,
  };
}

/**
 * Combines a `YYYY-MM-DD` date with a `1:00 PM` style time into an ISO instant.
 *
 * The mock times carry no zone. They are interpreted as UTC deliberately: the alternative is the seed
 * host's local zone, which would make the seeded data differ between a developer's machine and CI.
 */
export function combineDateAndTime(date: string, time: string): string {
  const match = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) {
    throw new Error(`Unrecognized open-house time: "${time}"`);
  }
  const meridiem = (match[3] ?? '').toUpperCase();
  let hour = Number(match[1]) % 12;
  if (meridiem === 'PM') {
    hour += 12;
  }
  const minutes = match[2] ?? '00';
  return `${date}T${String(hour).padStart(2, '0')}:${minutes}:00Z`;
}

/**
 * Maps the mock image URL array to `listing_media` rows, preserving order explicitly.
 *
 * A `text[]` column had no ordering guarantee, no alt text (an accessibility requirement), and no
 * per-asset key for IDX purge-on-expiry.
 */
export function mapToMediaRows(ids: string[], listingId: string, listing: MockListing): MediaRow[] {
  if (ids.length < listing.imageUrls.length) {
    throw new Error(
      `mapToMediaRows needs one id per image: got ${ids.length} for ${listing.imageUrls.length} images.`,
    );
  }
  return listing.imageUrls.map((url, index) => ({
    id: ids[index] as string,
    listing_id: listingId,
    source_url: url,
    sort_order: index,
    is_primary: index === 0,
    is_sample: SEED_IS_SAMPLE,
  }));
}
