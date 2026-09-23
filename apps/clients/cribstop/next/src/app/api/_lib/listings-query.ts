import { searchRequestSchema } from '@cribstop/property-contracts';

/**
 * Pure query-parameter handling for the Property API proxy.
 *
 * Deliberately free of any `next/server` import: this module holds the compliance-critical
 * allowlist, and keeping it runtime-free means it can be unit tested directly instead of only
 * through a route handler that needs a Next request/response runtime to load at all.
 */

/**
 * The set of query parameters that may reach the Property API, derived from the wire contract's
 * own request schema rather than written out here.
 *
 * This is an **allowlist, and that is the point**. `CompactSearchBar` used to collect occupancy
 * counts across age bands plus a service-animal question — age, familial status, family
 * responsibilities and disability are protected classes, and the standing rule (#34) is never
 * transmit, never persist, never index, never rank. #34's recorded decision removed that panel
 * outright, but the guarantee must not depend on the panel staying removed: a denylist has to be
 * remembered every time someone adds a field, whereas a parameter absent from the contract simply
 * has no way through this function. The contract has no occupancy field, so no occupancy value can
 * be forwarded even if a future caller passes one.
 */
export const FORWARDABLE_LISTING_PARAMS: readonly string[] = Object.freeze(
  Object.keys(searchRequestSchema.shape),
);

/**
 * Copies only allowlisted parameters onto the upstream query string, preserving repeats
 * (`amenities` may legitimately appear more than once).
 *
 * **A place search never ANDs two location filters (#220).** `zip`, `street` and `city` each
 * pin a place more precisely than free-text `query` can, and a city holds many zips while a zip
 * can straddle two cities — ANDing `query` on top narrows the result below what the user picked,
 * or matches nothing at all when the label (`"Rockville, MD"`) does not equal any single field.
 * `query` is dropped whenever one of those is present, rather than split or reduced, because
 * this proxy is the one place every route into the API passes through — the picker, a pasted or
 * bookmarked link, the backdrop behind a directly-loaded listing.
 *
 * **`state` never rides alongside `zip` (#220).** The zip already implies the state, so sending
 * both adds no precision.
 */
export function buildListingsQuery(incoming: URLSearchParams): string {
  const forwarded = new URLSearchParams();
  const hasPlaceFilter = ['zip', 'street', 'city'].some((key) => incoming.get(key));
  const hasZip = Boolean(incoming.get('zip'));

  for (const key of FORWARDABLE_LISTING_PARAMS) {
    if (key === 'query' && hasPlaceFilter) continue;
    if (key === 'state' && hasZip) continue;

    for (const value of incoming.getAll(key)) {
      if (value === '') continue;
      forwarded.append(key, value);
    }
  }

  return forwarded.toString();
}
