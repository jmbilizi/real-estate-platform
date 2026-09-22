/**
 * Serves the map tile provider config to the browser.
 *
 * The key ends up in every tile request URL, so it is visible to any visitor in devtools — it is
 * not hidden from users, and the real control against misuse is domain/HTTP-referrer restriction
 * on the MapTiler key itself (see #296's runbook), not secrecy of this response.
 *
 * `process.env.MAPTILER_API_KEY` (never `NEXT_PUBLIC_`) is still read here rather than baked in
 * at build time, because it is a *per-environment* value: this app's image is built once and
 * deployed to dev/test/prod with different keys injected at pod start. Reading it per request
 * lets one image serve all three; a `NEXT_PUBLIC_` value would be fixed to whichever key was
 * present when that image was built.
 *
 * A missing key (local dev before the key is provisioned) falls back to OpenStreetMap's own tile
 * server. OSMF's tile usage policy forbids commercial or heavy use of that endpoint (#291), so
 * `devOnly: true` on this response must never be true in a deployed environment — see
 * `map-tiles.ts`, which logs an error if it ever sees that combination in production.
 */

// Reads `process.env.MAPTILER_API_KEY` per request, not once at build time — matches
// `api/health/route.ts`'s defensive use of the same flag for the same reason.
export const dynamic = 'force-dynamic';

const MAPTILER_TILE_URL_TEMPLATE = 'https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png';
const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// OSMF's documented single-host form — no `{s}` subdomain sharding, which OSM has asked clients
// to stop using. Dev-only: see the module comment above.
const OSM_DEV_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export async function GET() {
  const key = process.env.MAPTILER_API_KEY;

  if (key) {
    return Response.json({
      tileUrl: `${MAPTILER_TILE_URL_TEMPLATE}?key=${key}`,
      attribution: MAPTILER_ATTRIBUTION,
      devOnly: false,
    });
  }

  return Response.json({
    tileUrl: OSM_DEV_TILE_URL,
    attribution: OSM_ATTRIBUTION,
    devOnly: true,
  });
}
