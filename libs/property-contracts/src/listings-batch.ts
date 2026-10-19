import { z } from 'zod';
import { errorBodySchema } from './errors';
import { listingsEnvelopeSchema } from './listing-card';

/**
 * `POST /listings/batch` (#960). One request runs the home page's row searches.
 *
 * Each row carries the same query-string parameters as `GET /listings`, and the service parses
 * them with `searchRequestSchema`. A row is public and non-personal: the response has no
 * `isSaved` flags and the service ignores any credential.
 */
export const LISTINGS_BATCH_MAX_ROWS = 12;

export const listingsBatchRowSchema = z.strictObject({
  /** The caller's name for the row. It comes back unchanged. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  /** Query-string parameters of `GET /listings`. A repeated parameter is an array. */
  params: z.record(
    z.string().max(64),
    z.union([z.string().max(200), z.array(z.string().max(200))]),
  ),
  /**
   * When true and `params` holds `city` and `state`, an empty result repeats with the state only,
   * then with no place. The first non-empty answer wins.
   */
  widen: z.boolean().default(false),
});

export const listingsBatchRequestSchema = z.strictObject({
  rows: z.array(listingsBatchRowSchema).min(1).max(LISTINGS_BATCH_MAX_ROWS),
});

const scopeSchema = z.strictObject({
  city: z.string().optional(),
  state: z.string().optional(),
});

export const listingsBatchResultSchema = z.union([
  z.object({ id: z.string(), scope: scopeSchema, result: listingsEnvelopeSchema }),
  z.object({ id: z.string(), error: errorBodySchema.shape.error }),
]);

export const listingsBatchResponseSchema = z.object({
  rows: z.array(listingsBatchResultSchema),
});

export type ListingsBatchRow = z.input<typeof listingsBatchRowSchema>;
export type ListingsBatchRequest = z.input<typeof listingsBatchRequestSchema>;
export type ListingsBatchResult = z.infer<typeof listingsBatchResultSchema>;
export type ListingsBatchResponse = z.infer<typeof listingsBatchResponseSchema>;
