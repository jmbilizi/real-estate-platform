/** Basemap providers. The server route and the client fallback share these values. */

export type MapConfig =
  | { provider: 'openfreemap'; styleUrl: string; attribution: string }
  | { provider: 'maptiler'; tileUrl: string; attribution: string };

export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// The text OpenFreeMap requires: OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors.
export const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">' +
  'OpenStreetMap</a> contributors';

export const MAPTILER_TILE_URL_TEMPLATE =
  'https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png';

export const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

export const OPENFREEMAP_CONFIG: MapConfig = {
  provider: 'openfreemap',
  styleUrl: OPENFREEMAP_STYLE_URL,
  attribution: OPENFREEMAP_ATTRIBUTION,
};

/** One place picks the provider: a MapTiler key selects MapTiler, no key selects OpenFreeMap. */
export function resolveMapConfig(maptilerKey: string | undefined): MapConfig {
  if (maptilerKey) {
    return {
      provider: 'maptiler',
      tileUrl: `${MAPTILER_TILE_URL_TEMPLATE}?key=${maptilerKey}`,
      attribution: MAPTILER_ATTRIBUTION,
    };
  }
  return OPENFREEMAP_CONFIG;
}
