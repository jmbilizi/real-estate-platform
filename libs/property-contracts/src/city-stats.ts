import { z } from 'zod';
import { stateCode } from './search-request';

/**
 * #985. `GET /listings/city-stats`: market statistics for one city, from the consumer-visible
 * active listings. The response has no listing row and no address, so it carries no seller data.
 *
 * A median needs enough inputs to mean something and to hide any one seller. A statistic with
 * fewer than `CITY_STATS_MIN_INPUTS` inputs has `value: null`. `inputCount` is always the number
 * of rows that fed the statistic, so a caller can tell "too few" from "no data".
 */

export const CITY_STATS_MIN_INPUTS = 5;
export const CITY_STATS_LISTING_TYPES = ['sale', 'rent'] as const;

export const cityStatsRequestSchema = z.strictObject({
  city: z.string().min(1).describe('Case-insensitive EXACT match on the city name. Required.'),
  state: stateCode,
  listingType: z
    .enum(CITY_STATS_LISTING_TYPES)
    .default('sale')
    .describe('`sale` (default) or `rent`. A sale median and a rent median never mix.'),
});

export type CityStatsRequest = z.infer<typeof cityStatsRequestSchema>;

export const cityStatSchema = z.object({
  value: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe(
      `Median, rounded to a whole number. Null when fewer than ${CITY_STATS_MIN_INPUTS} rows ` +
        'have the inputs.',
    ),
  inputCount: z.number().int().nonnegative(),
});

export type CityStat = z.infer<typeof cityStatSchema>;

export const cityStatsSchema = z.object({
  listingCount: z.number().int().nonnegative(),
  medianListPrice: cityStatSchema,
  medianDaysOnMarket: cityStatSchema,
  medianPricePerSqft: cityStatSchema,
  dataUpdatedAt: z.iso
    .datetime()
    .nullable()
    .describe('Newest MLS feed update among the counted listings. Null when there is none.'),
});

export type CityStats = z.infer<typeof cityStatsSchema>;
