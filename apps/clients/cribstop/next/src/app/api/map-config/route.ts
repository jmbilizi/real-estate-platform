/**
 * Serves the map tile provider config to the browser.
 *
 * Leaflet needs the tile URL and attribution client-side, but the API key must stay a
 * server-only env var — never `NEXT_PUBLIC_`. This app's image is built once and deployed to
 * dev/test/prod with different secrets injected at pod start, so a `NEXT_PUBLIC_` key would be
 * baked into the bundle for whichever environment built the image, and wrong for every other one.
 *
 * A missing key (local dev before the secret is provisioned) falls back to OpenStreetMap's own
 * tile server. OSMF's tile usage policy forbids commercial or heavy use of that endpoint (#291),
 * so `devOnly: true` on this response must never be true in a deployed environment — see
 * `map-tiles.ts`, which logs an error if it ever sees that combination in production.
 */

const MAPTILER_TILE_URL_TEMPLATE = 'https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png';
const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// OSMF's documented single-host form — no `{s}` subdomain sharding, which OSM has asked clients
// to stop using. Dev-only: see the module comment above.
const OSM_DEV_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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
