import { z } from 'zod';
import { listingCardSchema } from './listing-card';
import { mediaSchema, openHouseSchema, propertyTypeSchema } from './common';

/**
 * Durable site facts the view drops. Display-suppressed values are NOT re-sourced from here.
 * May differ from `listing.yearBuilt`/`listing.lotSqft` — those are a one-way snapshot frozen
 * when the listing was advertised, this is the current durable value.
 */
const propertyFactsSchema = z.object({
  id: z.string(),
  propertyType: propertyTypeSchema,
  yearBuilt: z.number().int().nullable(),
  lotSqft: z.number().int().nullable(),
});

/**
 * Present only for a genuinely subdivided building. `unitNumber` is nulled whenever the address
 * was masked — otherwise the suppressed address is reconstructible from zip + unit number.
 */
const unitFactsSchema = z.object({
  id: z.string(),
  unitNumber: z.string().nullable(),
  beds: z.number().int().nullable(),
  baths: z.number().nullable(),
  sqft: z.number().int().nullable(),
});

const listingDetailFieldsSchema = listingCardSchema
  .omit({ primaryMedia: true, openHouse: true })
  .extend({
    description: z.string().nullable(),
    media: z.array(mediaSchema),
    openHouses: z.array(openHouseSchema),
  });

/** The object graph, not a card. `unit: null` means "the offer is the whole property". */
export const listingDetailSchema = z.object({
  property: propertyFactsSchema,
  unit: unitFactsSchema.nullable(),
  listing: listingDetailFieldsSchema,
});

export type ListingDetail = z.infer<typeof listingDetailSchema>;
