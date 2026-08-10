import { z } from 'zod';
import {
  amenitySchema,
  attributionSchema,
  consumerStatusSchema,
  idSchema,
  listingSourceSchema,
  listingTypeSchema,
  mediaSchema,
  openHouseSchema,
  propertyTypeSchema,
} from './common';

/**
 * The flat card projection. Every nullable field is `.nullable()` and never `.optional()`:
 * a `0` for a land parcel's beds asserts a fact that is false (PRD §6.3) and corrupts range
 * predicates, and an omitted key is indistinguishable from null to a JSON client.
 */
export const listingCardSchema = z
  .object({
    id: idSchema,
    title: z.string(),
    // Null when the seller opted out of address display. The coordinates are masked with it —
    // publishing the point re-identifies the address.
    address: z.string().nullable(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
    neighborhood: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    // Nullable ahead of Bright's seller-directed field-level suppression (announced 2026-07-09).
    price: z.number().nonnegative().nullable(),
    status: consumerStatusSchema,
    listingType: listingTypeSchema,
    source: listingSourceSchema,
    propertyType: propertyTypeSchema,
    beds: z.number().int().nonnegative().nullable(),
    baths: z.number().nonnegative().nullable(),
    sqft: z.number().int().nonnegative().nullable(),
    lotSqft: z.number().int().nonnegative().nullable(),
    yearBuilt: z.number().int().nonnegative().nullable(),
    primaryMedia: mediaSchema.nullable(),
    // The soonest UPCOMING occurrence, or null. There is deliberately no unbounded boolean.
    openHouse: openHouseSchema.nullable(),
    amenities: z.array(amenitySchema),
    featured: z.boolean(),
    // Paid placement ranks first under `recommended`; the label is a disclosure obligation.
    sponsored: z.boolean(),
    priceReduced: z.boolean(),
    newConstruction: z.boolean(),
    isSample: z.boolean(),
    closePrice: z.number().nonnegative().nullable(),
    closeDate: z.iso.date().nullable(),
    lastUpdated: z.iso.datetime(),
  })
  .extend(attributionSchema.shape);

/** Echo of the normalised filter set the server actually applied. */
export const appliedFiltersSchema = z.record(z.string(), z.unknown());

export const listingsEnvelopeSchema = z.object({
  results: z.array(listingCardSchema),
  /** Exact, not an estimate — the client computes pageCount from it. */
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  appliedFilters: appliedFiltersSchema,
});

export type ListingCardRow = z.infer<typeof listingCardSchema>;
export type AppliedFilters = z.infer<typeof appliedFiltersSchema>;
export type ListingsEnvelope = z.infer<typeof listingsEnvelopeSchema>;
