import { z } from 'zod';
import { idSchema, listingSourceSchema, listingTypeSchema, propertyTypeSchema } from './common';
import { listingCardSchema } from './listing-card';
import { listingDetailSchema } from './listing-detail';

/**
 * The property page (#382): `/property/<slug>/<homeId>`, one page per home in any market status.
 *
 * The service decides every display rule and resolves every value the page renders. A client
 * renders `latestListing` when it is present and the property record alone when it is null. It
 * never re-derives a rule from `marketStatus`.
 */

export const MARKET_STATUSES = [
  'Active',
  'Coming Soon',
  'Under Contract',
  'Pending',
  'Sold',
  'Off market',
] as const;
export const marketStatusSchema = z.enum(MARKET_STATUSES);
export type MarketStatus = z.infer<typeof marketStatusSchema>;

/**
 * Facts from the property record only. No listing photo, price, remarks or agent data can appear
 * here (NAR 7.58: the data of a withdrawn, expired, canceled or held listing is not displayed).
 * `address` and `unitNumber` are null when the seller withheld the address.
 */
export const propertyRecordSchema = z.object({
  propertyId: idSchema,
  address: z.string().nullable(),
  unitNumber: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  propertyType: propertyTypeSchema,
  beds: z.number().int().nonnegative().nullable(),
  baths: z.number().nonnegative().nullable(),
  sqft: z.number().int().nonnegative().nullable(),
  lotSqft: z.number().int().nonnegative().nullable(),
  yearBuilt: z.number().int().nonnegative().nullable(),
  source: listingSourceSchema,
  isSample: z.boolean(),
});

/**
 * One past listing of the home. Only a listing whose data may display appears here: a withdrawn,
 * expired or canceled listing, or a sale outside the sold display rule, is left out entirely.
 */
export const propertyHistoryEntrySchema = z.object({
  listingId: idSchema,
  marketStatus: marketStatusSchema,
  listingType: listingTypeSchema,
  /** Null when the seller suppressed the price. */
  price: z.number().nonnegative().nullable(),
  closePrice: z.number().nonnegative().nullable(),
  closeDate: z.iso.date().nullable(),
  lastUpdated: z.iso.datetime(),
});

export const propertySeoSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export const propertyPageSchema = z
  .object({
    /** The id in the URL: the unit id in a subdivided building, else the property id. */
    homeId: idSchema,
    propertyId: idSchema,
    unitId: idSchema.nullable(),
    /** The slug segment of `canonicalPath`. A request with another slug gets a 308. */
    slug: z.string(),
    canonicalPath: z.string(),
    marketStatus: marketStatusSchema,
    /** False for Off market: `latestListing` is then null and only `propertyRecord` renders. */
    listingDataDisplayable: z.boolean(),
    seo: propertySeoSchema,
    propertyRecord: propertyRecordSchema,
    latestListing: listingDetailSchema.nullable(),
    /** Past listings, newest first. The latest listing is not repeated here. */
    history: z.array(propertyHistoryEntrySchema),
    /** Other active listings near the home. */
    nearby: z.array(listingCardSchema),
  })
  .superRefine((page, ctx) => {
    const offMarket = page.marketStatus === 'Off market';
    if (page.listingDataDisplayable === offMarket) {
      ctx.addIssue({ code: 'custom', message: 'Off market is the only non-displayable status.' });
    }
    if ((page.latestListing !== null) !== page.listingDataDisplayable) {
      ctx.addIssue({ code: 'custom', message: 'latestListing is present only when displayable.' });
    }
  });

/** `GET /properties/lookup`: the two segments of a #349 address path. */
export const propertyLookupRequestSchema = z
  .object({
    city: z.string().min(4).max(80),
    address: z.string().min(3).max(200),
  })
  .strict();

export const propertyMatchSchema = z.object({
  homeId: idSchema,
  /** The canonical property page path of the match. */
  path: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  marketStatus: marketStatusSchema,
});

/** One match: redirect to it. More than one: the page shows a choice. None is a 404. */
export const propertyLookupResponseSchema = z.object({
  matches: z.array(propertyMatchSchema).min(1),
});

export type PropertyRecord = z.infer<typeof propertyRecordSchema>;
export type PropertyHistoryEntry = z.infer<typeof propertyHistoryEntrySchema>;
export type PropertySeo = z.infer<typeof propertySeoSchema>;
export type PropertyPage = z.infer<typeof propertyPageSchema>;
export type PropertyLookupRequest = z.infer<typeof propertyLookupRequestSchema>;
export type PropertyMatch = z.infer<typeof propertyMatchSchema>;
export type PropertyLookupResponse = z.infer<typeof propertyLookupResponseSchema>;
