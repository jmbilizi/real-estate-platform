import type { SearchRequest } from '@cribstop/property-contracts';

type ListingType = 'sale' | 'rent' | 'sold';

/**
 * THE sold gate. One named function, so tightening solds display is one edit rather than a search
 * for every place `'sold'` appears.
 *
 * Two rules, deliberately in different places:
 *
 *  1. **Publishability** — a Closed listing with no `close_date` is not publishable. That rule is
 *     enforced by `listing_search_v` itself (`consumer_status <> 'Sold' OR close_date IS NOT NULL`)
 *     and is NOT restated here: a second copy of a compliance predicate is a second place for it to
 *     drift. Bright's delay window (#33) is measured from that same close date, so it lands there —
 *     one predicate plus a migration.
 *  2. **Opt-in** — which is this function. `all` is a shopping surface: the default search and the
 *     footer's "Search All" serve a consumer who wants homes they can buy or rent, so sold is
 *     excluded unless asked for by name. Sold is also the most MLS-restricted data class we touch
 *     (per-MLS permission, nondisclosure-jurisdiction price limits, and a Bright delay window we do
 *     not yet hold), and funnelling it through one branch keeps exactly one path to tighten.
 */
export function visibleListingTypesFor(
  requested: SearchRequest['listingType'],
): readonly ListingType[] {
  return requested === 'all' ? ['sale', 'rent'] : [requested];
}
