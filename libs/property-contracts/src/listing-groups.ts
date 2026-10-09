import { z } from 'zod';
import {
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
  .omit({ sort: true, page: true, pageSize: true })
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

export const zipGroupSchema = z.object({
  key: z.string().describe('The five-digit ZIP code.'),
  count: z.number().int().nonnegative().describe('Listing cards in the ZIP code.'),
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
