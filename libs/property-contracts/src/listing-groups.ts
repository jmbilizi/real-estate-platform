import { z } from 'zod';
import {
  NEIGHBORHOOD_PREVIEW_PHOTOS_MAX,
  neighborhoodPreviewPhotoSchema,
  NEIGHBORHOODS_LIMIT_MAX,
  NEIGHBORHOODS_MIN_COUNT_MAX,
  NEIGHBORHOODS_ORDERS,
} from './neighborhoods';
import { MAX_RESULT_OFFSET, searchRequestSchema } from './search-request';

/**
 * #722. `GET /listings/zips`: the listings of a search, grouped by ZIP code. Each group counts the
 * cards `GET /listings` returns for the same filters, so the group counts add up to the search
 * total. The endpoint never ranks, features or describes a group.
 */

export const LISTING_GROUPS_MIN_COUNT_DEFAULT = 1;
export const LISTING_GROUPS_LIMIT_DEFAULT = 24;

const queryMinCount = z
  .string()
  .regex(/^([1-9]\d{0,2}|1000)$/, `must be a whole number from 1 to ${NEIGHBORHOODS_MIN_COUNT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(NEIGHBORHOODS_MIN_COUNT_MAX))
  .describe(
    `Whole number from 1 to ${NEIGHBORHOODS_MIN_COUNT_MAX}. Default ${LISTING_GROUPS_MIN_COUNT_DEFAULT}. ` +
      'A group with fewer listings is omitted. A value above 1 makes the group counts add up to ' +
      'less than `listingTotal`.',
  );

const queryLimit = z
  .string()
  .regex(/^([1-9][0-9]?|100)$/, `must be a whole number from 1 to ${NEIGHBORHOODS_LIMIT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(NEIGHBORHOODS_LIMIT_MAX))
  .describe(
    `Whole number from 1 to ${NEIGHBORHOODS_LIMIT_MAX}. Default ${LISTING_GROUPS_LIMIT_DEFAULT}.`,
  );

const queryOffset = z
  .string()
  .regex(/^\d{1,5}$/, `must be a whole number from 0 to ${MAX_RESULT_OFFSET}`)
  .transform(Number)
  .pipe(z.number().int().min(0).max(MAX_RESULT_OFFSET))
  .describe(
    `Whole number from 0 to ${MAX_RESULT_OFFSET}. Default 0. Skips this many groups in the order ` +
      'given by `order`. `total` stays the exact group count.',
  );

/**
 * The search filters of `GET /listings`, minus paging and sort, plus group paging. Strict: an
 * unknown parameter is a 400.
 */
export const listingGroupsRequestSchema = searchRequestSchema
  .omit({ sort: true, page: true, pageSize: true, skipTotal: true })
  .extend({
    minCount: queryMinCount.default(LISTING_GROUPS_MIN_COUNT_DEFAULT),
    limit: queryLimit.default(LISTING_GROUPS_LIMIT_DEFAULT),
    offset: queryOffset.default(0),
    order: z
      .enum(NEIGHBORHOODS_ORDERS)
      .default('count')
      .describe(
        '`count` (default): listing count descending. `name`: name ascending. Ties break by `key`. ' +
          'No other order exists.',
      ),
  });

export type ListingGroupsRequest = z.infer<typeof listingGroupsRequestSchema>;

export const zipsRequestSchema = listingGroupsRequestSchema;
export type ZipsRequest = ListingGroupsRequest;

/** The same photo field, count and rule as a neighborhood row (#486). */
const previewPhotos = z
  .array(neighborhoodPreviewPhotoSchema)
  .max(NEIGHBORHOOD_PREVIEW_PHOTOS_MAX)
  .optional()
  .describe(
    `Up to ${NEIGHBORHOOD_PREVIEW_PHOTOS_MAX} primary photos, one per listing card of the group, ` +
      'newest listed first. A listing whose media display is suppressed adds none. Absent when no ' +
      'listing qualifies.',
  );

export const zipGroupSchema = z.object({
  key: z.string().describe('The five-digit ZIP code.'),
  count: z.number().int().nonnegative().describe('Listing cards in the ZIP code.'),
  previewPhotos,
});

export type ZipGroup = z.infer<typeof zipGroupSchema>;

/**
 * `total` is the exact count of groups that pass `minCount`. `listingTotal` is the exact count of
 * listing cards the search returns, before `minCount`. With the default `minCount`, the group
 * counts add up to `listingTotal`.
 */
export const zipsResponseSchema = z.object({
  groups: z.array(zipGroupSchema),
  total: z.number().int().nonnegative(),
  listingTotal: z.number().int().nonnegative(),
});

export type ZipsResponse = z.infer<typeof zipsResponseSchema>;

/**
 * #722. `GET /listings/brokers`: the same search, grouped by listing office. The key is the MLS
 * office key, so two spellings of one office form one group and two offices with one name stay
 * apart. Listings with no office key form one group with the key `unlisted`, so the counts still
 * add up. No brokerage is ranked, featured or left out.
 */
export const BROKER_UNLISTED_NAME = 'Other / unlisted';

export const brokersRequestSchema = listingGroupsRequestSchema;
export type BrokersRequest = ListingGroupsRequest;

export const brokerGroupSchema = z.object({
  key: z
    .string()
    .describe('The MLS office key, or `unlisted` for listings that carry no office key.'),
  name: z
    .string()
    .describe(
      'The office name of the most recently updated listing in the group. ' +
        `\`${BROKER_UNLISTED_NAME}\` for the unlisted group.`,
    ),
  count: z.number().int().nonnegative().describe('Listing cards of the office.'),
  previewPhotos,
});

export type BrokerGroup = z.infer<typeof brokerGroupSchema>;

export const brokersResponseSchema = z.object({
  groups: z.array(brokerGroupSchema),
  total: z.number().int().nonnegative(),
  listingTotal: z.number().int().nonnegative(),
});

export type BrokersResponse = z.infer<typeof brokersResponseSchema>;
