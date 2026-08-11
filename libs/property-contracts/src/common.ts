import { z } from 'zod';

/** The three-value consumer listing type. `sold` is derived from status, not stored. */
export const LISTING_TYPES = ['sale', 'rent', 'sold'] as const;
export const PROPERTY_TYPES = [
  'Single Family',
  'Condo',
  'Townhome',
  'Multi-Family',
  'Loft',
  'Land',
  'New Construction',
] as const;
/** Closed set — mirrors the CHECK on `listings.amenities`. Adding a value here without a
 *  migration produces a filter the database can never satisfy. */
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
export const CONSUMER_STATUSES = ['Active', 'Pending', 'Coming Soon', 'Sold'] as const;
export const LISTING_SOURCES = ['brightMLS', 'internal', 'other'] as const;

export const listingTypeSchema = z.enum(LISTING_TYPES);
export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export const amenitySchema = z.enum(AMENITIES);
export const consumerStatusSchema = z.enum(CONSUMER_STATUSES);
export const listingSourceSchema = z.enum(LISTING_SOURCES);

/** Every entity id in this contract, request and response alike. The database columns are
 *  `uuid` defaulting to `uuidv7()` — a single source of truth here means the hand-written
 *  `/listings/{id}` path parameter in `openapi.ts` can be derived from it instead of drifting. */
export const idSchema = z.uuid();

/** Media is an object, never a bare URL: alt text is an accessibility requirement and is
 *  consumer-visible copy subject to the same review as a description. */
export const mediaSchema = z.object({
  url: z.url(),
  altText: z.string().nullable(),
});

/** Instants, not date strings — so "upcoming" is a comparison rather than a parse. */
export const openHouseSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  remarks: z.string().nullable(),
});

/** NAR Policy 7.58 + PRD §6.2. Every key is present on every row; no caller may strip them. */
export const attributionSchema = z.object({
  listingAgentName: z.string().nullable(),
  brokerName: z.string(),
  brokerPhone: z.string(),
  brokerEmail: z.email(),
  officeName: z.string(),
  officeBrokerLeadPhone: z.string().nullable(),
  officeBrokerLeadEmail: z.email().nullable(),
  listedBy: z.string(),
});

/** Derived from the schema itself, not hand-copied, so the published OpenAPI assertions and any
 *  future consumer of "all eight attribution keys" cannot drift from the actual field list. */
export const ATTRIBUTION_KEYS = Object.keys(attributionSchema.shape) as Array<
  keyof typeof attributionSchema.shape
>;

export type Media = z.infer<typeof mediaSchema>;
export type OpenHouse = z.infer<typeof openHouseSchema>;
export type Attribution = z.infer<typeof attributionSchema>;
