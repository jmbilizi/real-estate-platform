'use client';

import { useCallback, useEffect, useState } from 'react';
import { TileLayer, useMap } from 'react-leaflet';
import '@/components/maplibre-worker';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type MapConfig, resolveRasterFallback } from '@/lib/map-providers';
import { supportsWebGL2 } from '@/lib/webgl2';
import { SafeMaplibreGL } from '@/components/safe-maplibre-layer';

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
  onUnsupported,
}: {
  styleUrl: string;
  attribution: string;
  onTileError: () => void;
  onUnsupported: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    const layer = new SafeMaplibreGL({
      style: styleUrl,
      // Leaflet's attribution control shows this text. The plugin disables MapLibre's own control.
      attributionControl: { customAttribution: attribution },
    });
    try {
      layer.addTo(map);
    } catch {
      // The GPU is blocklisted or has no WebGL2 although the feature test passed (#762). The
      // guarded `onRemove` of `SafeMaplibreGL` is a no-op without a GL map, and it unregisters
      // the events Leaflet attached before the add failed.
      try {
        map.removeLayer(layer);
      } catch {
        // Nothing more to clean up.
      }
      onUnsupported();
      return;
    }
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
  }, [map, styleUrl, attribution, onTileError, onUnsupported]);

  return null;
}

/** The basemap for every Leaflet map. Renders nothing until the config arrives. */
export default function BasemapLayer({ config, onTileError }: Props) {
  const [glFailed, setGlFailed] = useState(false);
  const onUnsupported = useCallback(() => setGlFailed(true), []);
  if (!config) return null;

  // Vector needs WebGL2. Without it, or when the add failed, draw raster tiles instead.
  const vector = config.provider === 'openfreemap' && supportsWebGL2() && !glFailed;
  if (config.provider === 'openfreemap' && vector) {
    return (
      <VectorLayer
        styleUrl={config.styleUrl}
        attribution={config.attribution}
        onTileError={onTileError}
        onUnsupported={onUnsupported}
      />
    );
  }
  const raster = resolveRasterFallback(config);
  if (raster.provider === 'openfreemap') return null;
  return (
    <TileLayer
      attribution={raster.attribution}
      url={raster.tileUrl}
      // `L.TileLayer` defaults to maxZoom 18, independent of the map. Match the map's 19.
      maxZoom={BASEMAP_MAX_ZOOM}
      eventHandlers={{ tileerror: onTileError }}
    />
  );
}
