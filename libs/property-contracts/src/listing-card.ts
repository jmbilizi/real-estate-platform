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
 *
 * **Lean-list / rich-detail split (PRD §3.1):** A results page renders ~20 of these cards on the
 * first screen a new visitor sees. Every field here is paid twenty times per page. This shape must
 * stay lean: flat fields only, one primary image only. The full graph (photo gallery, description,
 * open houses, unit detail) is returned only by the detail endpoint and fetched only when a user
 * actually opens a listing. Attribution is required on both list and detail (NAR 7.58); description
 * and media galleries are detail-only. No field-selection parameter may exist here that could
 * strip attribution. Enforce the detail-only rules via an e2e test: this schema must never carry
 * description, media arrays, openHouses arrays, or nested property/unit objects.
 */
export const listingCardSchema = z
  .object({
    id: idSchema,
    // #386. The home this listing is on: the unit id in a subdivided building, else the property
    // id. Internal identity only — the page URL (`propertyPath`) carries this listing's own id.
    propertyId: idSchema,
    propertyPath: z.string(),
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
    // #53. Null when the seller suppressed days-on-market display, independent of price.
    daysOnMarket: z.number().int().nonnegative().nullable(),
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
    // #717. The earlier MLS list price we hold for this home, and the day of the change. The day
    // is midnight UTC of the calendar day in the property time zone. Both are null when we hold no
    // earlier price, or when the seller withheld the price or its history. The card shows the
    // difference of two stored MLS prices. It never shows an estimate.
    previousPrice: z.number().positive().nullable(),
    priceChangedAt: z.iso.datetime().nullable(),
    newConstruction: z.boolean(),
    isSample: z.boolean(),
    closePrice: z.number().nonnegative().nullable(),
    closeDate: z.iso.date().nullable(),
    lastUpdated: z.iso.datetime(),
    // #391. Null when the feed carries no list date for this listing.
    listedAt: z.iso.datetime().nullable(),
    // #424. The date a Coming Soon listing goes active. Null when the feed carries none, or the
    // listing is not Coming Soon. Drives the card's status badge only.
    comingSoonDate: z.iso.datetime().nullable(),
    // #459. The instant the listing was listed, only when the feed proves it: the status change is
    // on the list date and is not a date-only midnight. Null otherwise. Never a guess.
    listedAtPrecise: z.iso.datetime().nullable(),
    // #23. Present only on an authenticated request, omitted for a signed-out caller. This is the one
    // field a card may omit: a per-user value cannot live in a shared-cache response. Both names
    // carry the same value, resolved by home id, so every listing of a saved home reads as saved.
    isSaved: z.boolean().optional(),
    isFavorited: z.boolean().optional(),
  })
  .extend(attributionSchema.shape);

/** Echo of the normalised filter set the server actually applied. */
export const appliedFiltersSchema = z.record(z.string(), z.unknown());

export const listingsEnvelopeSchema = z.object({
  results: z.array(listingCardSchema),
  /**
   * Exact, not an estimate — the client computes pageCount from it. The one exception is a request
   * with `skipTotal=true` (#755): `total` then holds the number of results on the page.
   */
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  appliedFilters: appliedFiltersSchema,
});

export type ListingCardRow = z.infer<typeof listingCardSchema>;
export type AppliedFilters = z.infer<typeof appliedFiltersSchema>;
export type ListingsEnvelope = z.infer<typeof listingsEnvelopeSchema>;
