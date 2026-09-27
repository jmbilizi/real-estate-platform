import { z } from 'zod';
import { stateCode } from './search-request';

/**
 * `GET /listings/neighborhoods` (#390): counts of publishable listings grouped by neighborhood, for
 * the home page's "Explore neighborhoods" row. No ranking, no descriptive word — counts only, so
 * this never becomes a second, unreviewed `featured` mechanism.
 */

export const NEIGHBORHOODS_LISTING_TYPES = ['sale', 'rent'] as const;

export const NEIGHBORHOODS_MIN_COUNT_DEFAULT = 3;
export const NEIGHBORHOODS_MIN_COUNT_MAX = 1000;
export const NEIGHBORHOODS_LIMIT_DEFAULT = 24;
export const NEIGHBORHOODS_LIMIT_MAX = 100;

/**
 * Regex-tightened to the exact bound, mirroring `queryPage`/`queryPageSize` in `search-request.ts`
 * (#47 review, C1): a bare `.min()`/`.max()` on the far side of `.pipe()` is invisible to
 * `z.toJSONSchema({io: 'input'})`, so the published bound would silently say less than the service
 * enforces unless the regex itself carries it.
 */
const queryMinCount = z
  .string()
  .regex(/^([1-9]\d{0,2}|1000)$/, `must be a whole number from 1 to ${NEIGHBORHOODS_MIN_COUNT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(NEIGHBORHOODS_MIN_COUNT_MAX))
  .describe(
    `Whole number from 1 to ${NEIGHBORHOODS_MIN_COUNT_MAX}. Default ${NEIGHBORHOODS_MIN_COUNT_DEFAULT}. ` +
      'A neighborhood whose matching count (see `listingType`) is below this is omitted.',
  );

const queryLimit = z
  .string()
  .regex(/^([1-9][0-9]?|100)$/, `must be a whole number from 1 to ${NEIGHBORHOODS_LIMIT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(NEIGHBORHOODS_LIMIT_MAX))
  .describe(
    `Whole number from 1 to ${NEIGHBORHOODS_LIMIT_MAX}. Default ${NEIGHBORHOODS_LIMIT_DEFAULT}.`,
  );

/**
 * Strict, matching `searchRequestSchema`: an unknown parameter is a 400, not a silently ignored
 * typo.
 */
export const neighborhoodsRequestSchema = z.strictObject({
  state: stateCode.optional(),
  city: z
    .string()
    .optional()
    .describe('Case-insensitive exact match against the neighborhood’s city.'),
  listingType: z
    .enum([...NEIGHBORHOODS_LISTING_TYPES, 'all'] as const)
    .default('all')
    .describe(
      '`sale`, `rent` or `all` (default). Each returned row’s `total` counts only this type; ' +
        '`sale` and `rent` are always both reported regardless of this filter.',
    ),
  minCount: queryMinCount.default(NEIGHBORHOODS_MIN_COUNT_DEFAULT),
  limit: queryLimit.default(NEIGHBORHOODS_LIMIT_DEFAULT),
  slug: z
    .string()
    .optional()
    .describe('Exact match against the derived slug (see `NeighborhoodRow.slug`).'),
});

export type NeighborhoodsRequest = z.infer<typeof neighborhoodsRequestSchema>;

export const neighborhoodRowSchema = z.object({
  name: z.string(),
  city: z.string(),
  state: z.string(),
  slug: z.string(),
  total: z.number().int().nonnegative(),
  sale: z.number().int().nonnegative(),
  rent: z.number().int().nonnegative(),
});

export type NeighborhoodRow = z.infer<typeof neighborhoodRowSchema>;

/**
 * `total` here is the exact count of matching neighborhoods, never clamped to `limit` — the same
 * convention `ListingsEnvelope.total` follows, for the same reason (PRD §6.3: a clamped count is a
 * fabricated fact).
 */
export const neighborhoodsResponseSchema = z.object({
  results: z.array(neighborhoodRowSchema),
  total: z.number().int().nonnegative(),
});

export type NeighborhoodsResponse = z.infer<typeof neighborhoodsResponseSchema>;
