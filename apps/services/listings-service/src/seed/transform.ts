import { AMENITIES, Amenity, SEED_IS_SAMPLE, SEED_LISTING_SOURCE } from './constants';
import { CommunityRow, ListingRow, MockListing, PropertyRow, UnitRow } from './types';

/**
 * Pure mapping/validation functions that turn a mock listing (the frontend's
 * `Listing` shape) into rows for the `communities` / `properties` / `units` /
 * `listings` tables. Kept free of any I/O (no `pg`, no `crypto.randomUUID()`
 * calls) so they can be unit-tested without a database — ids are supplied by
 * the caller (`seed.ts`, which generates them and performs the actual writes).
 */

/**
 * Validates that every amenity in the input is a member of the fixed
 * Amenity enum (PRD §3.1). Throws on the first unrecognized value so bad
 * mock data fails loudly at seed time instead of silently reaching the DB.
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
 * Groups mock listings into synthetic communities keyed by
 * neighborhood + city + state, so listings sharing a neighborhood are
 * seeded under one `communities` row instead of being orphaned.
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
  return { id, name: communityNameFor(listing) };
}

export function mapToPropertyRow(
  id: string,
  communityId: string | null,
  listing: MockListing,
): PropertyRow {
  return {
    id,
    community_id: communityId,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,
    property_type: listing.propertyType,
    year_built: listing.yearBuilt ?? null,
  };
}

/**
 * Extracts a unit designator (e.g. "1201", "4", "3B", "PH1") from a mock
 * address like "800 F St NW Unit 1201" / "1330 Kenyon St NW Apt 4" /
 * "1000 Fell St Loft 3B" / "501 Slaters Ln PH1". Returns null when the
 * address doesn't reference a sub-unit (single-family/townhome listings).
 */
const UNIT_NUMBER_PATTERN =
  /\b(?:Unit|Apt|Suite|Ste)\.?\s+([A-Za-z0-9-]+)\b|\bLoft\s+([A-Za-z0-9-]+)\b|\b(PH\d+[A-Za-z]?)\b/i;

export function extractUnitNumber(address: string): string | null {
  const match = address.match(UNIT_NUMBER_PATTERN);
  if (!match) {
    return null;
  }
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Builds a `units` row when the listing's address implies a sub-unit of a
 * property (condo/apartment/penthouse). Returns null for properties with no
 * unit subdivision (single-family homes, townhomes, land) — units are
 * optional per PRD §3.
 */
export function mapToUnitRow(id: string, propertyId: string, listing: MockListing): UnitRow | null {
  const unitNumber = extractUnitNumber(listing.address);
  if (!unitNumber) {
    return null;
  }
  return {
    id,
    property_id: propertyId,
    unit_number: unitNumber,
    floor: null,
    sqft: listing.sqft,
  };
}

export function mapToListingRow(
  id: string,
  propertyId: string,
  unitId: string | null,
  listing: MockListing,
): ListingRow {
  const amenities = validateAmenities(listing.amenities);
  return {
    id,
    property_id: propertyId,
    unit_id: unitId,
    title: listing.title,
    listing_type: listing.listingType,
    // Seed/dev data must never be represented as MLS-sourced, regardless of
    // what the mock dataset says (PRD §6.2/§6.3) — always force 'internal'.
    source: SEED_LISTING_SOURCE,
    status: listing.status,
    price: listing.price,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    lot_sqft: listing.lotSqft ?? null,
    year_built: listing.yearBuilt ?? null,
    neighborhood: listing.neighborhood,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,
    latitude: listing.latitude,
    longitude: listing.longitude,
    image_urls: listing.imageUrls,
    description: listing.description,
    amenities,
    featured: listing.featured,
    price_reduced: listing.priceReduced ?? false,
    new_construction: listing.newConstruction ?? false,
    open_house_date: listing.openHouse?.date ?? null,
    open_house_start_time: listing.openHouse?.startTime ?? null,
    open_house_end_time: listing.openHouse?.endTime ?? null,
    broker_name: listing.brokerName,
    broker_phone: listing.brokerPhone,
    broker_email: listing.brokerEmail,
    office_name: listing.officeName,
    office_broker_lead_phone: listing.officeBrokerLeadPhone ?? null,
    office_broker_lead_email: listing.officeBrokerLeadMail ?? null,
    // Seeded rows are always sample data and must be labelled (PRD §6.3).
    is_sample: SEED_IS_SAMPLE,
    last_updated: listing.lastUpdated,
  };
}
