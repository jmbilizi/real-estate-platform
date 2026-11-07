import {
  listingGroupsRequestSchema,
  mapRequestSchema,
  neighborhoodsRequestSchema,
  searchRequestSchema,
  suggestRequestSchema,
} from '@cribstop/property-contracts';

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

/** The map endpoint's allowlist (#377): the search filters without paging or sort, plus the viewport. */
export const FORWARDABLE_MAP_PARAMS: readonly string[] = Object.freeze(
  Object.keys(mapRequestSchema.shape),
);

/** The neighborhoods endpoint's allowlist (#393), derived the same way. */
export const FORWARDABLE_NEIGHBORHOODS_PARAMS: readonly string[] = Object.freeze(
  Object.keys(neighborhoodsRequestSchema.shape),
);

/** The ZIP and broker group endpoints' allowlist (#722), derived the same way. */
export const FORWARDABLE_GROUPS_PARAMS: readonly string[] = Object.freeze(
  Object.keys(listingGroupsRequestSchema.shape),
);

/** The Where suggestions endpoint's allowlist (#781), derived the same way. */
export const FORWARDABLE_SUGGEST_PARAMS: readonly string[] = Object.freeze(
  Object.keys(suggestRequestSchema.shape),
);

/**
 * The search parameters that the map, group and neighborhood endpoints do not take (#221). The
 * client sends the full search query to them, so the proxy drops these on purpose. The upstream
 * schemas are strict and answer 400 if the proxy forwards them.
 */
export const SEARCH_ONLY_PARAMS: readonly string[] = Object.freeze(
  FORWARDABLE_LISTING_PARAMS.filter((key) => !FORWARDABLE_MAP_PARAMS.includes(key)),
);

/** Thrown when a request carries a parameter that the endpoint's contract does not define (#221). */
export class UnknownListingParamsError extends Error {
  constructor(readonly params: readonly string[]) {
    super(
      `Unknown query parameter: ${params
        .slice(0, 5)
        .map((p) => p.slice(0, 40))
        .join(', ')}.`,
    );
    this.name = 'UnknownListingParamsError';
  }
}

/**
 * Copies only allowlisted parameters onto the upstream query string, preserving repeats
 * (`amenities` may legitimately appear more than once).
 *
 * **An unknown parameter is rejected, not dropped (#221).** A silent drop answers a typo or a
 * removed filter with a normal-looking, wider result. `ignored` names contract parameters that the
 * endpoint does not take. Those are dropped. An empty value of a known parameter is dropped. An unknown parameter is rejected whatever its value, so an extra tracking parameter such as `utm_source` gets 400.
 *
 * **A place search never ANDs two location filters (#220).** `zip`, `street`, `city`,
 * `neighborhood` and `county` each pin a place more precisely than free-text `query` can, and a
 * city holds many zips while a zip can straddle two cities — ANDing `query` on top narrows the
 * result below what the user picked, or matches nothing at all when the label
 * (`"Rockville, MD"`) does not equal any single field. `query` is dropped whenever one of those
 * is present, rather than split or reduced, because this proxy is the one place every route into
 * the API passes through — the picker, a pasted or bookmarked link, the backdrop behind a
 * directly-loaded listing.
 *
 * **`state` never rides alongside `zip` (#220).** The zip already implies the state, so sending
 * both adds no precision. `neighborhood`/`county` DO ride alongside `state` (and `city`,
 * for `neighborhood`) — a neighborhood or county name alone can collide across states, so the
 * search bar sends it paired with state precisely because it does add precision there (#339).
 */
export function buildListingsQuery(
  incoming: URLSearchParams,
  allowed: readonly string[] = FORWARDABLE_LISTING_PARAMS,
  ignored: readonly string[] = [],
): string {
  const unknown = [...new Set(incoming.keys())].filter(
    (key) => !allowed.includes(key) && !ignored.includes(key),
  );
  if (unknown.length > 0) throw new UnknownListingParamsError(unknown);

  const forwarded = new URLSearchParams();
  const hasPlaceFilter = ['zip', 'street', 'city', 'neighborhood', 'county', 'boundary'].some(
    (key) => incoming.get(key),
  );
  const hasZip = Boolean(incoming.get('zip'));

  for (const key of allowed) {
    if (key === 'query' && hasPlaceFilter) continue;
    if (key === 'state' && hasZip) continue;

    for (const value of incoming.getAll(key)) {
      if (value === '') continue;
      forwarded.append(key, value);
    }
  }

  return forwarded.toString();
}
