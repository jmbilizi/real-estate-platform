/**
 * Enum-like value lists shared by the schema (CHECK constraints), the seed
 * transform logic, and (eventually) request validation in the search/detail
 * service (#22).
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
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const LISTING_TYPES = ['sale', 'rent', 'sold'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const LISTING_SOURCES = ['brightMLS', 'internal', 'other'] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

export const LISTING_STATUSES = ['Active', 'Pending', 'Coming Soon', 'Sold'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/**
 * Every row inserted by the seed script must be tagged with this source,
 * regardless of what the mock data says — seed/dev data must never be
 * represented as MLS-sourced (PRD §6.2/§6.3). The seed dataset itself is
 * already authored as `internal`; this override is defence in depth so the
 * invariant cannot be broken by editing the data file alone.
 */
export const SEED_LISTING_SOURCE: ListingSource = 'internal';

/**
 * Every row inserted by the seed script is sample/dev data and must be
 * labelled as such (PRD §6.3) — it is never real inventory, regardless of how
 * plausible the addresses and prices look.
 */
export const SEED_IS_SAMPLE = true;
