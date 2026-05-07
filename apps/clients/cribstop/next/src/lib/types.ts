export type ListingType = "sale" | "rent" | "sold";
export type PropertyType =
  | "Single Family"
  | "Condo"
  | "Townhome"
  | "Multi-Family"
  | "Loft"
  | "Land"
  | "New Construction";

export type Amenity =
  | "Pool"
  | "Garage"
  | "Gym"
  | "Elevator"
  | "Balcony"
  | "Fireplace"
  | "Washer/Dryer"
  | "Pet Friendly"
  | "Waterfront"
  | "Office"
  | "Rooftop"
  | "Garden"
  | "Smart Home"
  | "Solar"
  | "EV Charging";

export interface Listing {
  id: string;
  title: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  neighborhood: string;
  price: number;
  status: "Active" | "Pending" | "Coming Soon" | "Sold";
  listingType: ListingType;
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
  lastUpdated: string;
  description: string;
  amenities: Amenity[];
  latitude: number;
  longitude: number;
  featured: boolean;
  openHouse?: { date: string; startTime: string; endTime: string } | null;
  priceReduced?: boolean;
  newConstruction?: boolean;
  listedBy: string;
  isSaved?: boolean;
  isFavorited?: boolean;
}

export interface SearchFilters {
  query?: string;
  zip?: string;
  street?: string;
  listingType?: ListingType | "all";
  propertyType?: PropertyType | "all";
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  baths?: number;
  minSqft?: number;
  neighborhood?: string;
  openHouse?: boolean;
  newConstruction?: boolean;
  waterfront?: boolean;
  petFriendly?: boolean;
  amenities?: Amenity[];
  sort?: "recommended" | "newest" | "price-asc" | "price-desc";
}
