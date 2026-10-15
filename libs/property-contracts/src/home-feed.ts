import { z } from 'zod';
import { idSchema } from './common';
import { listingCardSchema } from './listing-card';

/**
 * `POST /home-feed` (#835). The v1 rules ranker for the home page.
 *
 * The request carries the visitor's local profile (#833). The service reads it, ranks, and
 * stores nothing. The strict objects reject any field that is not listed, so a demographic,
 * school or crime field has no way in.
 */

export const HOME_FEED_SIDES = ['sale', 'rent'] as const;
export const HOME_FEED_MAX_ITEMS = 50;
export const HOME_FEED_MAX_PLACES = 5;
export const HOME_FEED_ROW_IDS = [
  'picked',
  'new',
  'price-drops',
  'near-you',
  'just-listed',
  'coming-soon',
] as const;

/** A place label the title can carry. Letters, digits and plain punctuation only. */
const placeLabelSchema = z.string().regex(/^[\p{L}\p{N} .,'-]{1,80}$/u);

export const homeFeedProfileItemSchema = z.strictObject({
  listingId: idSchema,
  kind: z.enum(['view', 'save']),
  side: z.enum(HOME_FEED_SIDES),
  at: z.number().int().nonnegative(),
});

export const homeFeedProfileSchema = z.strictObject({
  items: z.array(homeFeedProfileItemSchema).max(HOME_FEED_MAX_ITEMS),
  /** Searched places. A search counts as a warm signal. The ranker does not read the text. */
  places: z.array(z.string().max(120)).max(HOME_FEED_MAX_PLACES),
});

export const homeFeedRequestSchema = z.strictObject({
  profile: homeFeedProfileSchema.nullable().default(null),
  target: z.strictObject({
    city: placeLabelSchema,
    state: z.string().regex(/^[A-Za-z]{2}$/),
    /** The target centre. When absent, the service derives it from the city. */
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  }),
  /** Search radius in km. Null means the whole state. */
  radiusKm: z.number().min(1).max(100).nullable().default(20),
  side: z.enum(HOME_FEED_SIDES).default('sale'),
  /** The A/B arm the client chose. The service echoes it on every row. */
  variant: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .default('v1'),
});

export const homeFeedListingSchema = z.object({
  listing: listingCardSchema,
  /** True for the exploration slot. Log it with the impression (#824). */
  explore: z.boolean(),
});

export const homeFeedRowSchema = z.object({
  rowId: z.enum(HOME_FEED_ROW_IDS),
  title: z.string(),
  modelVersion: z.string(),
  variant: z.string(),
  listings: z.array(homeFeedListingSchema),
});

export const homeFeedResponseSchema = z.object({
  modelVersion: z.string(),
  variant: z.string(),
  rows: z.array(homeFeedRowSchema),
});

export type HomeFeedRequest = z.infer<typeof homeFeedRequestSchema>;
export type HomeFeedRow = z.infer<typeof homeFeedRowSchema>;
export type HomeFeedResponse = z.infer<typeof homeFeedResponseSchema>;
