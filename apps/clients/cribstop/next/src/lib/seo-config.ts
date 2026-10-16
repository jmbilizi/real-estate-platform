/**
 * The fewest active listings an indexable place page may have (#842). A page below it is
 * `noindex, follow`, because a thin page at scale is a low-value page. Set
 * `THIN_PAGE_MIN_LISTINGS` to change it without a code change.
 */
const DEFAULT_THIN_PAGE_MIN_LISTINGS = 10;

export function thinPageMinListings(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.THIN_PAGE_MIN_LISTINGS ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_THIN_PAGE_MIN_LISTINGS;
}
