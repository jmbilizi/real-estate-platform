import { z } from 'zod';
import { listingCardSchema } from './listing-card';
import { idSchema, mediaSchema, openHouseSchema, propertyTypeSchema } from './common';

/**
 * Durable site facts the view drops. Display-suppressed values are NOT re-sourced from here.
 * May differ from `listing.yearBuilt`/`listing.lotSqft` — those are a one-way snapshot frozen
 * when the listing was advertised, this is the current durable value.
 */
const propertyFactsSchema = z.object({
  id: idSchema,
  propertyType: propertyTypeSchema,
  yearBuilt: z.number().int().nonnegative().nullable(),
  lotSqft: z.number().int().nonnegative().nullable(),
});

/**
 * Present only for a genuinely subdivided building. `unitNumber` is nulled whenever the address
 * was masked — otherwise the suppressed address is reconstructible from zip + unit number.
 */
const unitFactsSchema = z.object({
  id: idSchema,
  unitNumber: z.string().nullable(),
  beds: z.number().int().nonnegative().nullable(),
  baths: z.number().nonnegative().nullable(),
  sqft: z.number().int().nonnegative().nullable(),
});

/**
 * #564. One gallery photo on the detail page. `altText` is Bright's short description. `caption` is
 * its long description. Both are null on an address-suppressed listing.
 */
export const detailMediaSchema = mediaSchema.extend({
  caption: z.string().nullable(),
});

/**
 * #564. Grouped facts. Each group is the list Bright carries, or `null` when it carries none.
 * There is no group for tags, keywords or neighborhood character.
 */
export const listingFactsSchema = z.object({
  parking: z.array(z.string()).nullable(),
  heating: z.array(z.string()).nullable(),
  cooling: z.array(z.string()).nullable(),
  appliances: z.array(z.string()).nullable(),
  basement: z.array(z.string()).nullable(),
  flooring: z.array(z.string()).nullable(),
  interior: z.array(z.string()).nullable(),
  exterior: z.array(z.string()).nullable(),
});

/**
 * #564. Detail-only facts from the Bright record. Never on the card or the map payload. Every key
 * is present. A fact the feed does not carry is `null`.
 */
const listingExtraFieldsSchema = z.object({
  taxAnnualAmount: z.number().nonnegative().nullable(),
  taxYear: z.number().int().nullable(),
  hoaFee: z.number().nonnegative().nullable(),
  hoaFeeFrequency: z.string().nullable(),
  // The unbranded virtual tour only. Null when the seller withheld the address.
  // The service nulls a value that fails this shape. The client opens `https` only.
  virtualTourUrl: z.url({ protocol: /^https?$/ }).nullable(),
  // The listing agent's own contact. The office name and phone are in the attribution fields.
  listAgentPhone: z.string().nullable(),
  listAgentEmail: z.email().nullable(),
  facts: listingFactsSchema,
  // #716. The other live MLS records of this home, oldest first. Each opens at its own URL. The
  // `mlsNumber` is null when the sync has not stored it yet.
  alsoListedAs: z.array(z.object({ id: idSchema, mlsNumber: z.string().nullable() })),
  // #716. The oldest list date among this record and the other live records of the home. The
  // client shows it as "Listed since" when `daysOnMarket` is null. Null when no record has a date.
  listedSince: z.iso.datetime().nullable(),
});

const listingDetailFieldsSchema = listingCardSchema
  .omit({ primaryMedia: true, openHouse: true })
  .extend({
    description: z.string().nullable(),
    media: z.array(detailMediaSchema),
    openHouses: z.array(openHouseSchema),
  })
  .extend(listingExtraFieldsSchema.shape);

/** The object graph, not a card. `unit: null` means "the offer is the whole property". */
export const listingDetailSchema = z.object({
  property: propertyFactsSchema,
  unit: unitFactsSchema.nullable(),
  listing: listingDetailFieldsSchema,
});

export type ListingDetail = z.infer<typeof listingDetailSchema>;
export type DetailMedia = z.infer<typeof detailMediaSchema>;
export type ListingFacts = z.infer<typeof listingFactsSchema>;
