import { useCallback, useEffect, useState } from 'react';
import { type MapConfig, OPENFREEMAP_CONFIG } from '@/lib/map-providers';

// Cached across every map on the page: one fetch per tab, not one per map.
let cached: Promise<MapConfig> | null = null;

function fetchMapConfig(): Promise<MapConfig> {
  if (cached) return cached;
  // OpenFreeMap needs no key, so a failed fetch falls back to it. A failure is not cached, so the
  // next map on this tab tries again.
  const attempt = fetch('/api/map-config')
    .then((res) => {
      if (!res.ok) throw new Error(`map-config responded ${res.status}`);
      return res.json() as Promise<MapConfig>;
    })
    .catch(() => {
      cached = null;
      return OPENFREEMAP_CONFIG;
    });
  cached = attempt;
  return attempt;
}

/** Fetches the basemap config from `/api/map-config`. Null until it answers. */
export function useMapConfig(): MapConfig | null {
  const [config, setConfig] = useState<MapConfig | null>(null);

  useEffect(() => {
    let active = true;
    fetchMapConfig().then((c) => {
      if (active) setConfig(c);
    });
    return () => {
      active = false;
    };
  }, []);

  return config;
}

/**
 * Tracks whether the basemap failed to load, so an outage shows a visible degraded state instead
 * of a silent blank map. One error is enough: an outage fails many tiles at once.
 *
 * It cannot catch a provider that returns HTTP 200 with a placeholder image (the CARTO failure in
 * #291). It covers a failed fetch only.
 */
export function useTileFailure() {
  const [failed, setFailed] = useState(false);
  // Stable: the vector layer re-creates itself when this changes.
  const onTileError = useCallback(() => setFailed(true), []);
  return { failed, onTileError };
}
