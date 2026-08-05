import { Amenity, ListingSource, ListingStatus, ListingType, PropertyType } from './constants';

/**
 * Shape of one entry in the frontend mock dataset
 * (`apps/clients/cribstop/next/src/lib/listings.ts`), trimmed to the fields
 * the seed transform needs. Field names/casing mirror the frontend `Listing`
 * interface (`apps/clients/cribstop/next/src/lib/types.ts`) so the mapping
 * in `transform.ts` is a straight camelCase -> snake_case translation.
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
  openHouse?: { date: string; startTime: string; endTime: string } | null;
  priceReduced?: boolean;
  newConstruction?: boolean;
}

export interface CommunityRow {
  id: string;
  name: string;
}

export interface PropertyRow {
  id: string;
  community_id: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
  property_type: PropertyType;
  year_built: number | null;
}

export interface UnitRow {
  id: string;
  property_id: string;
  unit_number: string | null;
  floor: number | null;
  sqft: number | null;
}

export interface ListingRow {
  id: string;
  property_id: string;
  unit_id: string | null;
  title: string;
  listing_type: ListingType;
  source: ListingSource;
  status: ListingStatus;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  lot_sqft: number | null;
  year_built: number | null;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  image_urls: string[];
  description: string;
  amenities: Amenity[];
  featured: boolean;
  price_reduced: boolean;
  new_construction: boolean;
  open_house_date: string | null;
  open_house_start_time: string | null;
  open_house_end_time: string | null;
  broker_name: string;
  broker_phone: string;
  broker_email: string;
  office_name: string;
  office_broker_lead_phone: string | null;
  office_broker_lead_email: string | null;
  is_sample: boolean;
  last_updated: string;
}
