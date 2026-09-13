/**
 * The Overpass proxy's query construction, kept apart from the request that sends it.
 *
 * Same split as `nominatim.ts` / `nominatim-fetch.ts`, and for the same reason: everything that
 * decides *what we ask a third party for under our identity and our rate limit* is pure, so it can
 * be enumerated in tests without a route handler or a network. The handler is then only transport
 * — timeout, caching, failure shape.
 */

/** The only `place` values this app looks up. Anything else is not a request we make. */
const PLACE_TYPES = new Set(['city', 'town', 'village']);

/**
 * Overpass's own budget for *executing* the query, declared inside the query and enforced by the
 * server. It is not a client timeout and never was: it starts counting once Overpass has the query
 * and is parsing it, so it does nothing at all for a connection that stalls or is reset before
 * then — which is exactly the failure mode this endpoint hits on a filtered network. The handler
 * derives its own timeout from this value.
 */
export const QUERY_TIMEOUT_SECONDS = 10;

/**
 * Coordinate precision, in decimal places, used for both the upstream query and the cache key.
 *
 * Caching this endpoint is pointless without it. The caller passed the map's centre straight
 * through at full float precision (`38.89553417351007`), so every pixel of pan produced a URL never
 * seen before and a cache that could not hit once. Three decimals is ~110m, which against a radius
 * measured in kilometres cannot change which towns come back — so it collapses that unbounded key
 * space onto a grid the cache can reuse.
 *
 * `lib/search-utils.tsx` rounds to the same grid before building the URL, because the browser's
 * HTTP cache keys on what *it* sends; this side rounds anyway, because a proxy cannot trust a
 * client to have done it. A drift between the two is a cache-hit regression, not a correctness one.
 */
export const COORD_PRECISION = 3;

/**
 * Bounds on the search radius.
 *
 * It used to be forwarded unvalidated, so a caller could ask Overpass — a free, shared, heavily
 * loaded public endpoint — for a continent-sized query in our name, and a non-numeric value reached
 * the query builder as `around:NaN` and came back a 502. Clamping also keeps the cache key space
 * finite, which is the other half of making the caching worth anything.
 *
 * This is not the rate limiting #84 asks for and does not close it; it stops this one parameter
 * from being an amplifier.
 */
export const DEFAULT_RADIUS_METERS = 20_000;
export const MIN_RADIUS_METERS = 1_000;
export const MAX_RADIUS_METERS = 50_000;

export type BuiltQuery = { ok: true; query: string } | { ok: false; error: string };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * A numeric query parameter, or `null` when it was not supplied.
 *
 * `Number(params.get(name))` cannot express that distinction and quietly gets it wrong twice over:
 * a **missing** parameter reads back as `null`, and `Number(null)` is `0` — not `NaN` — so a
 * request carrying no coordinates at all validated as the perfectly real point (0, 0) in the Gulf
 * of Guinea and was forwarded upstream. An **empty** one (`?radiusMeters=`) reads back as `''`,
 * which `??` does not treat as absent either, and `Number('')` is likewise `0`.
 *
 * Both cases have to be caught before the value reaches a range check, because zero passes every
 * range check there is.
 */
function numericParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function buildNearbyPlacesQuery(params: URLSearchParams): BuiltQuery {
  const lat = numericParam(params, 'lat');
  const lon = numericParam(params, 'lon');
  const placeType = params.get('placeType') || '';

  /*
   * Range-checked, not merely present-and-finite. A latitude of 500 is a perfectly finite number
   * and an impossible place; forwarding it spends an upstream request to be told so.
   */
  const validCoords = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  if (!validCoords || !PLACE_TYPES.has(placeType)) {
    return { ok: false, error: 'Invalid parameters' };
  }

  const rawRadius = numericParam(params, 'radiusMeters');
  const radiusMeters =
    rawRadius === null
      ? DEFAULT_RADIUS_METERS
      : clamp(rawRadius, MIN_RADIUS_METERS, MAX_RADIUS_METERS);

  const gridLat = lat.toFixed(COORD_PRECISION);
  const gridLon = lon.toFixed(COORD_PRECISION);

  return {
    ok: true,
    query: `
    [out:json][timeout:${QUERY_TIMEOUT_SECONDS}];
    (
      node[place=${placeType}](around:${radiusMeters},${gridLat},${gridLon});
    );
    out body center 20;
  `,
  };
}
