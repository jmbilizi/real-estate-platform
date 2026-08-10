import { z } from 'zod';
import { listingSourceSchema } from './common';

/**
 * Dataset freshness for the footer, which renders on every route and so cannot depend on a search.
 * `dataUpdatedAt` is MLS feed freshness — never a local write time, never `updated_at`.
 * Null is a real state: with no publishable listings the footer omits the line rather than
 * substituting the current time, which would be fabricated data (PRD §6.3).
 */
export const listingsMetaSchema = z.object({
  dataUpdatedAt: z.string().nullable(),
  sources: z.array(listingSourceSchema),
  listingCount: z.number().int(),
});

export type ListingsMeta = z.infer<typeof listingsMetaSchema>;
