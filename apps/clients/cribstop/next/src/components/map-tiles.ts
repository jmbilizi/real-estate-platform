import { useState } from 'react';

/**
 * The keyless OpenStreetMap standard raster tile server.
 *
 * CARTO's free Voyager basemap (`basemaps.cartocdn.com`) began requiring an API key this app
 * never held. Every tile request still returned HTTP 200, but the image was a watermarked
 * "API key required" placeholder instead of a map (#291). This endpoint needs no key.
 */
export const TILE_LAYER_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_LAYER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const TILE_LAYER_SUBDOMAINS = 'abc';

/**
 * Tracks whether map tiles have failed to load, so a future provider outage shows a visible
 * degraded state instead of a silent blank map. One `tileerror` is enough to flag it: a tile
 * outage fails many tiles at once, and the banner should appear on the first sign of it.
 */
export function useTileFailure() {
  const [failed, setFailed] = useState(false);
  return { failed, onTileError: () => setFailed(true) };
}
