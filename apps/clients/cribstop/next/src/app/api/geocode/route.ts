import { NextRequest } from 'next/server';
import { buildForwardUrl } from '../_lib/nominatim';
import { proxyNominatim } from '../_lib/nominatim-fetch';

/**
 * Forward geocoding — a place name or ZIP to a coordinate, optionally with a boundary polygon.
 *
 * This used to hardcode `limit=5&addressdetails=1&q=…` and nothing else, which is exactly why the
 * search page did not use it: it needs `limit=1`, a `postalcode` lookup for a ZIP, and the boundary
 * polygon, none of which this could express. So it called Nominatim from the browser instead, where
 * CORS blocked it and no `User-Agent` could be sent. Widening the proxy — through an allowlist, not
 * a pass-through — is what let those calls come back here where they belong.
 */
export async function GET(req: NextRequest) {
  return proxyNominatim(buildForwardUrl(req.nextUrl.searchParams), 'forward search');
}
