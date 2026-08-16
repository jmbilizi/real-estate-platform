/**
 * Pure query handling for the Nominatim proxy.
 *
 * Deliberately free of any `next/server` import, like `listings-query`: the allowlist is the
 * security-relevant part, so it is unit tested directly rather than only through a route handler
 * that needs a Next runtime to load at all.
 *
 * ## Why every geocode call has to go through our server
 *
 * Two independent reasons, and the second is the one that is easy to miss.
 *
 * 1. **CORS.** `nominatim.openstreetmap.org` does not reliably answer a cross-origin browser
 *    request, so five call sites — the search page's centre and boundary lookups, and four reverse
 *    lookups in the search bar — were failing outright. The visible symptom was a map that never
 *    centred and never drew its boundary, plus four console errors per search. It failed silently
 *    in the sense that mattered: nothing in the UI said anything was wrong.
 *
 * 2. **Nominatim's usage policy requires an identifying `User-Agent`, and a browser cannot send
 *    one.** `User-Agent` is a forbidden header name — `fetch` drops it. Those call sites all *tried*
 *    to set it, which tells you the intent was right and the mechanism could never work: every one
 *    of them was anonymous to the upstream, which is a breach of the terms we are using the service
 *    under, quite apart from whether the response came back. Only a server can honour that, which is
 *    why the proxy is not merely a CORS workaround but the only correct path.
 *
 * The policy also asks that results be cached rather than refetched; see the route handlers.
 */

/** Fixed for every request: this app only geocodes US places, and only wants JSON. */
const FIXED_PARAMS = 'format=json&countrycodes=us';

/**
 * Vertex simplification for boundary polygons.
 *
 * A raw city boundary is hundreds of kilobytes; this drops roughly 85% of the vertices for a shape
 * that is indistinguishable at map zoom, taking the payload to ~5-15KB. Held here rather than
 * passed by the caller so that no caller can ask for the unsimplified geometry.
 */
const POLYGON_THRESHOLD = '0.005';

export type BuiltUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Builds the upstream **forward** search URL from an allowlisted subset of the caller's parameters.
 *
 * An allowlist rather than a pass-through, for the same reason `listings-query` uses one: a proxy
 * that forwards whatever a caller appends is an open relay to a third party under our identity and
 * our rate limit. The parameter set a geocoder needs is small and closed, so nothing is lost by
 * enumerating it, and an unknown parameter is dropped rather than honoured.
 */
export function buildForwardUrl(params: URLSearchParams): BuiltUrl {
  const q = params.get('q');
  const postalcode = params.get('postalcode');

  if (q && postalcode) {
    return { ok: false, error: 'Provide either q or postalcode, not both' };
  }

  const parts = [FIXED_PARAMS];

  if (postalcode !== null) {
    // A ZIP is looked up as a postal code rather than as free text so the boundary that comes back
    // is the ZIP's own, not that of the city containing it.
    if (!/^\d{5}$/.test(postalcode)) return { ok: false, error: 'Invalid postalcode' };
    parts.push(`postalcode=${postalcode}`);
  } else if (q !== null) {
    const trimmed = q.trim();
    if (!trimmed) return { ok: false, error: 'Missing query' };
    // Bounded so a caller cannot push an arbitrarily large string through us to the upstream.
    if (trimmed.length > 200) return { ok: false, error: 'Query too long' };
    parts.push(`q=${encodeURIComponent(trimmed)}`);
  } else {
    return { ok: false, error: 'Missing query' };
  }

  const limit = params.get('limit') ?? '5';
  if (!/^([1-9]|10)$/.test(limit)) return { ok: false, error: 'Invalid limit' };
  parts.push(`limit=${limit}`);

  const addressdetails = params.get('addressdetails') ?? '1';
  if (addressdetails !== '0' && addressdetails !== '1') {
    return { ok: false, error: 'Invalid addressdetails' };
  }
  parts.push(`addressdetails=${addressdetails}`);

  // `polygon=1` is our own flag, not Nominatim's: it selects the boundary shape *and* the
  // simplification above, so the two cannot be requested separately.
  const polygon = params.get('polygon');
  if (polygon !== null) {
    if (polygon !== '1') return { ok: false, error: 'Invalid polygon' };
    parts.push(`polygon_geojson=1&polygon_threshold=${POLYGON_THRESHOLD}`);
  }

  return { ok: true, url: `https://nominatim.openstreetmap.org/search?${parts.join('&')}` };
}

/** Builds the upstream **reverse** lookup URL. Same allowlist discipline as the forward case. */
export function buildReverseUrl(params: URLSearchParams): BuiltUrl {
  const rawLat = params.get('lat');
  const rawLon = params.get('lon');

  /*
   * Presence is checked before the range, because `Number(null)` is `0` — a missing coordinate
   * would otherwise pass every range check and be geocoded as (0, 0), a point in the Gulf of
   * Guinea, and come back as a confident answer about nowhere.
   */
  if (rawLat === null || rawLon === null) return { ok: false, error: 'Missing coordinate' };

  const lat = Number(rawLat);
  const lon = Number(rawLon);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'Invalid lat' };
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return { ok: false, error: 'Invalid lon' };

  /*
   * Capped at 10 — settlement level — rather than Nominatim's own maximum of 18.
   *
   * 18 is address level. This route is unauthenticated, so accepting it published a
   * coordinate-to-street-address lookup that anything on the internet could drive through our egress
   * IP and our identifying `User-Agent`, and that nothing in the app has ever asked for: all four
   * call sites in `CompactSearchBar` pass `zoom=10`, because what they want is the name of a place,
   * not a doorstep. It also cuts against this app's own posture on precision — a suppressed listing
   * withholds `address`, `latitude` and `longitude` together precisely so a coordinate cannot be
   * turned back into the address the seller withheld, and an open address-level reverse geocoder is
   * a way to do exactly that. Accept what the callers use; widen it deliberately if a caller ever
   * genuinely needs to.
   */
  const zoom = params.get('zoom') ?? '10';
  if (!/^([0-9]|10)$/.test(zoom)) return { ok: false, error: 'Invalid zoom' };

  const addressdetails = params.get('addressdetails') ?? '1';
  if (addressdetails !== '0' && addressdetails !== '1') {
    return { ok: false, error: 'Invalid addressdetails' };
  }

  return {
    ok: true,
    url:
      `https://nominatim.openstreetmap.org/reverse?${FIXED_PARAMS}` +
      `&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=${addressdetails}`,
  };
}
