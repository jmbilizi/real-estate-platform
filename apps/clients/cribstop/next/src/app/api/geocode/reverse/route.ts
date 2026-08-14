import { NextRequest } from 'next/server';
import { buildReverseUrl } from '../../_lib/nominatim';
import { proxyNominatim } from '../../_lib/nominatim-fetch';

/**
 * Reverse geocoding — a coordinate to a place name.
 *
 * Four call sites in `CompactSearchBar` needed this and had no proxy to call: the browser's current
 * location, and the enrichment pass that names each nearby place returned by Overpass. All four
 * went to Nominatim directly and all four were blocked, which is why "Current Location" fell back
 * to raw coordinates and the nearby-place suggestions came back unnamed.
 */
export async function GET(req: NextRequest) {
  return proxyNominatim(buildReverseUrl(req.nextUrl.searchParams), 'reverse lookup');
}
