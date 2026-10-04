import { z } from 'zod';
import { idSchema, propertyTypeSchema } from './common';
import { listingCardSchema } from './listing-card';
import { marketStatusSchema } from './property-page';
import { PAGE_SIZE_DEFAULT, queryPageSize } from './search-request';

/**
 * Saved homes (#23). A save belongs to an account and keys on the home, never on a listing.
 * `propertyId` is the home id of #386: the unit id in a subdivided building, else the property id.
 *
 * The list is home-shaped. A saved home with no consumer-visible listing is a normal row with
 * `listing: null`, never a 404 and never dropped from the list.
 */

/**
 * Durable facts of the home. Same masking as the property page: `address` and `unitNumber` are
 * null when any listing of the home withheld the address, and when the home has no listing the
 * service can read.
 */
export const savedHomePropertySchema = z.object({
  address: z.string().nullable(),
  unitNumber: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  neighborhood: z.string().nullable(),
  propertyType: propertyTypeSchema,
  beds: z.number().int().nonnegative().nullable(),
  baths: z.number().nonnegative().nullable(),
  sqft: z.number().int().nonnegative().nullable(),
  lotSqft: z.number().int().nonnegative().nullable(),
  yearBuilt: z.number().int().nonnegative().nullable(),
  isSample: z.boolean(),
});

export const savedHomeSchema = z.object({
  propertyId: idSchema,
  savedAt: z.iso.datetime(),
  /** The listing the consumer was looking at when they saved. Context only. Null when absent. */
  savedFromListingId: idSchema.nullable(),
  /** `Off market` exactly when `listing` is null. */
  marketStatus: marketStatusSchema,
  /** The canonical property page path. Null when the service holds no listing of the home. */
  canonicalPath: z.string().nullable(),
  property: savedHomePropertySchema,
  /**
   * The current consumer-visible listing, from the same view and the same masking as search.
   * Null for an off-market home. Price appears only here, so a price the view withholds is never
   * shown for a saved home.
   */
  listing: listingCardSchema.nullable(),
});

export const savedHomesRequestSchema = z.strictObject({
  page: z
    .string()
    .regex(/^[1-9]\d{0,6}$/, 'must be a whole number from 1 to 9999999')
    .transform(Number)
    .pipe(z.number().int().min(1))
    .default(1)
    .describe('Whole number from 1 to 9999999. Default 1.'),
  pageSize: queryPageSize.default(PAGE_SIZE_DEFAULT),
});

export const savedHomesEnvelopeSchema = z.object({
  results: z.array(savedHomeSchema),
  /** Exact count of the account's saved homes. */
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
});

/** The result of a save or an unsave. Both are idempotent. */
export const savedStateSchema = z.object({
  propertyId: idSchema,
  saved: z.boolean(),
});

export type SavedHomeProperty = z.infer<typeof savedHomePropertySchema>;
export type SavedHome = z.infer<typeof savedHomeSchema>;
export type SavedHomesRequest = z.output<typeof savedHomesRequestSchema>;
export type SavedHomesEnvelope = z.infer<typeof savedHomesEnvelopeSchema>;
export type SavedState = z.infer<typeof savedStateSchema>;
