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

/** "Alexandria, VA" / "Washington, D.C." — a place name followed by a US state or territory code. */
const PLACE_WITH_STATE = /^(.*[^\s,])\s*,\s*([A-Za-z]{2}|[A-Za-z]\.[A-Za-z]\.)\.?$/;

/**
 * Drops a trailing state code from a free-text place search (#80).
 *
 * The search bar labels a location suggestion `"City, ST"` and puts that whole string in `q`, so
 * `query` arrives as `"Alexandria, VA"`. The Property API matches `query` against title, address,
 * city, neighborhood and zip **individually**, so a value spanning two of those fields matches none
 * of them: picking any city returned zero listings, which is the entire Homes funnel dead on the
 * most obvious interaction there is.
 *
 * Corrected here rather than in the search bar because this is the one place every route into the
 * API passes through — the picker, a pasted or bookmarked `?q=Alexandria, VA` link, the backdrop
 * behind a directly-loaded listing. Fixing only the control that writes the URL would leave every
 * shared link still broken.
 *
 * **The state is dropped, not matched on**, because the contract has no field to match it against —
 * `query`, `zip`, `street` and `neighborhood` are the only text filters. So `"Springfield, VA"` and
 * `"Springfield, MD"` are the same search today, and `"Alexandria"` also matches an Alexandria Pike
 * in another city. That imprecision is accepted deliberately and is temporary: #81 adds real `city`
 * and `state` filters, at which point this becomes a split into two parameters instead of a
 * discard. Do not paper over it with heuristics in the meantime — a wider result set is a page the
 * user can act on, and a guessed one is not.
 */
export function toMatchableQuery(query: string): string {
  const match = PLACE_WITH_STATE.exec(query.trim());
  return match ? match[1] : query;
}

/**
 * Copies only allowlisted parameters onto the upstream query string, preserving repeats
 * (`amenities` may legitimately appear more than once).
 */
export function buildListingsQuery(incoming: URLSearchParams): string {
  const forwarded = new URLSearchParams();

  for (const key of FORWARDABLE_LISTING_PARAMS) {
    for (const value of incoming.getAll(key)) {
      if (value === '') continue;
      forwarded.append(key, key === 'query' ? toMatchableQuery(value) : value);
    }
  }

  return forwarded.toString();
}
