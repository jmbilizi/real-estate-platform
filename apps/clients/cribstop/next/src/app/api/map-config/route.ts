import { resolveMapConfig } from '@/lib/map-providers';

/**
 * Serves the basemap provider config to the browser.
 *
 * Default: OpenFreeMap vector tiles. It needs no key and no account, and its terms allow
 * commercial use (#296). `MAPTILER_API_KEY` is an optional override that selects MapTiler raster
 * tiles. The key ends up in every tile URL, so a visitor can read it. Restrict it by HTTP referrer
 * on the MapTiler side.
 *
 * `process.env.MAPTILER_API_KEY` is read per request, not at build time. The image is built once
 * and each environment injects its own value at pod start.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(resolveMapConfig(process.env.MAPTILER_API_KEY));
}
