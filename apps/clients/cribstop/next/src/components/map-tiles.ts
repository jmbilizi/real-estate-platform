import { useEffect, useState } from 'react';

export interface TileLayerConfig {
  /** Empty until `/api/map-config` answers — see `LOADING_CONFIG` below. */
  tileUrl: string;
  attribution: string;
  /** True only for the OpenStreetMap dev-only fallback (no licensed key configured). */
  devOnly?: boolean;
}

/**
 * Nothing renders until the real config loads — this does not default to the OpenStreetMap
 * fallback client-side, so a deployed environment missing its key shows no basemap rather than
 * silently sending it traffic OSMF's tile usage policy forbids (#291). `ListingsMapInner` and
 * `SingleListingMapInner` skip rendering `<TileLayer>` while `tileUrl` is empty.
 */
const LOADING_CONFIG: TileLayerConfig = { tileUrl: '', attribution: '' };

const DEV_FALLBACK: TileLayerConfig = {
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  devOnly: true,
};

// Cached across every map on the page — one fetch per tab, not one per `<TileLayer>`.
let cached: Promise<TileLayerConfig> | null = null;

function fetchTileConfig(): Promise<TileLayerConfig> {
  if (!cached) {
    cached = fetch('/api/map-config')
      .then((res) => (res.ok ? res.json() : DEV_FALLBACK))
      .catch(() => DEV_FALLBACK);
  }
  return cached;
}

/** Fetches the tile provider config from `/api/map-config` (see that route for why). */
export function useTileLayerConfig(): TileLayerConfig {
  const [config, setConfig] = useState<TileLayerConfig>(LOADING_CONFIG);

  useEffect(() => {
    let active = true;
    fetchTileConfig().then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, []);

  // A production build should always have the MapTiler key provisioned (#296). If it doesn't,
  // this fallback is reached in a deployed environment, which is exactly the OSMF-policy
  // violation #291 fixed — loud on purpose so it cannot go unnoticed the way the CARTO placeholder
  // watermark did.
  if (config.devOnly && process.env.NODE_ENV === 'production') {
    console.error(
      'Map tile key missing in a deployed build — using OpenStreetMap dev-only tiles, which ' +
        'its usage policy forbids for this traffic. Provision MAPTILER_API_KEY, tracked in #296.',
    );
  }

  return config;
}

/**
 * Tracks whether map tiles have failed to load, so a future provider outage shows a visible
 * degraded state instead of a silent blank map. One `tileerror` is enough to flag it: a tile
 * outage fails many tiles at once, and the banner should appear on the first sign of it.
 *
 * Does not catch the CARTO-shaped failure #291 fixed — that provider returned HTTP 200 with a
 * watermarked placeholder image, so no `tileerror` ever fired. This banner covers a tile *fetch*
 * failure; it does not (and cannot, from the browser) validate that a 200 response is a real tile.
 */
export function useTileFailure() {
  const [failed, setFailed] = useState(false);
  return { failed, onTileError: () => setFailed(true) };
}
