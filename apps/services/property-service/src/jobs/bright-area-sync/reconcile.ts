/**
 * Pure decision logic for the daily key reconciliation (#331).
 *
 * RESO sends no delete event. The only way to learn a listing left Bright is to read every
 * `ListingKey` Bright still holds for a tracked area and diff it against what is stored locally.
 *
 * The diff is deliberately taken against the UNION of every tracked status's live keys for the
 * area, not one status at a time: a listing that moved from Active to Pending is absent from the
 * live Active key set but present in the live Pending one, and that is a status change, not a
 * delete (#331's own scope note). Comparing status-by-status would soft-delete it wrongly the
 * moment its old status's set no longer contains it.
 */

/** One local listing this reconciliation pass is checking. */
export interface LocalBrightListing {
  readonly id: string;
  readonly sourceListingKey: string;
}

/**
 * The ids of local listings whose key is absent from `liveKeys` — the union of every `ListingKey`
 * Bright returned, this pass, across every tracked status for the area.
 */
export function staleListingIds(
  liveKeys: ReadonlySet<string>,
  localListings: readonly LocalBrightListing[],
): string[] {
  return localListings
    .filter((listing) => !liveKeys.has(listing.sourceListingKey))
    .map((listing) => listing.id);
}
