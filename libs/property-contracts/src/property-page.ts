import { z } from 'zod';
import { idSchema, listingSourceSchema, propertyTypeSchema } from './common';
import { listingDetailSchema } from './listing-detail';

/**
 * The property page (#349): one page per address, in its current market status.
 *
 * The service decides every display rule. The page renders `detail` when it is present and the
 * property record alone when it is null. It never re-derives a rule from `marketStatus`.
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
  listingId: idSchema,
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

export const propertyPageSchema = z
  .object({
    marketStatus: marketStatusSchema,
    /** False for Off market: `detail` is then null and only `propertyRecord` renders. */
    listingDataDisplayable: z.boolean(),
    /** The address URL. Null when the seller withheld the address. */
    path: z.string().nullable(),
    propertyRecord: propertyRecordSchema,
    detail: listingDetailSchema.nullable(),
  })
  .superRefine((page, ctx) => {
    const offMarket = page.marketStatus === 'Off market';
    if (page.listingDataDisplayable === offMarket) {
      ctx.addIssue({ code: 'custom', message: 'Off market is the only non-displayable status.' });
    }
    if ((page.detail !== null) !== page.listingDataDisplayable) {
      ctx.addIssue({ code: 'custom', message: 'detail is present only when displayable.' });
    }
  });

/** `GET /properties/lookup`: the two segments of a property path. */
export const propertyLookupRequestSchema = z
  .object({
    city: z.string().min(4).max(80),
    address: z.string().min(3).max(200),
  })
  .strict();

export const propertyMatchSchema = z.object({
  listingId: idSchema,
  path: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  marketStatus: marketStatusSchema,
});

/** One match: render it. More than one: the page shows a choice. None is a 404. */
export const propertyLookupResponseSchema = z.object({
  matches: z.array(propertyMatchSchema).min(1),
});

export type PropertyRecord = z.infer<typeof propertyRecordSchema>;
export type PropertyPage = z.infer<typeof propertyPageSchema>;
export type PropertyLookupRequest = z.infer<typeof propertyLookupRequestSchema>;
export type PropertyMatch = z.infer<typeof propertyMatchSchema>;
export type PropertyLookupResponse = z.infer<typeof propertyLookupResponseSchema>;
