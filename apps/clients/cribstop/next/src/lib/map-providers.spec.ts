import {
  MAPTILER_ATTRIBUTION,
  OPENFREEMAP_CONFIG,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  resolveMapConfig,
  resolveRasterFallback,
} from './map-providers';

describe('resolveRasterFallback', () => {
  it('keeps MapTiler when a key is set', () => {
    const config = resolveMapConfig('key');
    expect(resolveRasterFallback(config)).toBe(config);
    expect(config.attribution).toBe(MAPTILER_ATTRIBUTION);
  });

  it('uses OSM standard tiles with attribution when no key is set', () => {
    const fallback = resolveRasterFallback(OPENFREEMAP_CONFIG);
    expect(fallback).toMatchObject({ provider: 'osm', tileUrl: OSM_TILE_URL });
    expect(OSM_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(fallback.attribution).toBe(OSM_ATTRIBUTION);
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap');
  });
});
