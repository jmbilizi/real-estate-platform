import { z } from 'zod';
import { idSchema } from './common';

/**
 * `GET /listings/by-ids?ids=<id>,<id>` (#76). Card rows for a bounded set of listing ids, in one
 * request. The answer is a `ListingsEnvelope`, so every row carries the full attribution block.
 *
 * The id set travels in the query string, at most `LISTINGS_BY_IDS_MAX` ids. There is no body.
 * An id that does not resolve is absent from `results`. The route never answers 404 for a set.
 * The caller's id order is kept. A repeated id answers once.
 *
 * This is not a way to walk the dataset (#65). The request must name its ids, the cap is small,
 * and an id is an opaque UUID that no search result lets a caller enumerate in bulk.
 */
export const LISTINGS_BY_IDS_MAX = 50;

/** Comma-joined (`?ids=a,b`) or repeated (`?ids=a&ids=b`). */
const idList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(idSchema).min(1).max(LISTINGS_BY_IDS_MAX))
  .describe(
    `Comma-separated or repeated listing ids (UUIDs). 1 to ${LISTINGS_BY_IDS_MAX} ids. More than ` +
      `${LISTINGS_BY_IDS_MAX} is a 400, never a silent truncation.`,
  );

export const listingsByIdsRequestSchema = z.strictObject({ ids: idList });

export type ListingsByIdsRequest = z.infer<typeof listingsByIdsRequestSchema>;
