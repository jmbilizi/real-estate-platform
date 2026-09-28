import { z } from 'zod';
import { listingSourceSchema } from './common';

/**
 * Dataset freshness for the footer, which renders on every route and so cannot depend on a search.
 * `dataUpdatedAt` is MLS feed freshness — never a local write time, never `updated_at`.
 * Null is a real state: with no publishable listings the footer omits the line rather than
 * substituting the current time, which would be fabricated data (PRD §6.3).
 *
 * `lastSyncedAt` is the last time the Bright sync worker actually finished a run — never a listing
 * field. #438: "Updated X ago" on the home page must reflect the sync, not the newest feed
 * timestamp among listings, which can be older than the run that fetched it. Optional and nullable:
 * older deployments and a dataset with no succeeded run yet both have no value to report. Callers
 * fall back to `dataUpdatedAt` when it is absent.
 */
export const listingsMetaSchema = z.object({
  dataUpdatedAt: z.iso.datetime().nullable(),
  lastSyncedAt: z.iso.datetime().nullable().optional(),
  sources: z.array(listingSourceSchema),
  listingCount: z.number().int().nonnegative(),
});

export type ListingsMeta = z.infer<typeof listingsMetaSchema>;
