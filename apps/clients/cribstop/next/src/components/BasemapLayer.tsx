'use client';

import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapConfig } from '@/lib/map-providers';

// maplibre-gl finds its worker from `import.meta.url`, which the bundler rewrites, so the default
// URL is empty and the worker fails to load. Point it at the worker file as a bundled asset. The
// worker file has no imports, so one emitted file is enough.
setWorkerUrl(String(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)));

/** Matches the `maxZoom` of both maps. Vector tiles overzoom past their native level. */
export const BASEMAP_MAX_ZOOM = 19;

interface Props {
  config: MapConfig | null;
  onTileError: () => void;
}

/** OpenFreeMap vector tiles, drawn by MapLibre GL into a Leaflet layer. */
function VectorLayer({
  styleUrl,
  attribution,
  onTileError,
}: {
  styleUrl: string;
  attribution: string;
  onTileError: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    const layer = maplibreGL({
      style: styleUrl,
      // Leaflet's attribution control shows this text. The plugin disables MapLibre's own control.
      attributionControl: { customAttribution: attribution },
    });
    layer.addTo(map);
    const gl = layer.getMaplibreMap();
    // Only a source (tile) error counts. A glyph or sprite error must not raise the banner.
    const onError = (e: unknown) => {
      if ((e as { sourceId?: string }).sourceId) onTileError();
    };
    gl.on('error', onError);
    return () => {
      gl.off('error', onError);
      map.removeLayer(layer);
    };
  }, [map, styleUrl, attribution, onTileError]);

  return null;
}

/** The basemap for every Leaflet map. Renders nothing until the config arrives. */
export default function BasemapLayer({ config, onTileError }: Props) {
  if (!config) return null;
  if (config.provider === 'openfreemap') {
    return (
      <VectorLayer
        styleUrl={config.styleUrl}
        attribution={config.attribution}
        onTileError={onTileError}
      />
    );
  }
  return (
    <TileLayer
      attribution={config.attribution}
      url={config.tileUrl}
      // `L.TileLayer` defaults to maxZoom 18, independent of the map. Match the map's 19.
      maxZoom={BASEMAP_MAX_ZOOM}
      eventHandlers={{ tileerror: onTileError }}
    />
  );
}
