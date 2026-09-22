'use client';

import { useEffect } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ListingType } from '@/lib/types';
import { formatListingPrice } from '@/lib/listing-format';
import { useTileFailure, useTileLayerConfig } from '@/components/map-tiles';

function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 0);
    const t2 = setTimeout(() => map.invalidateSize(), 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map]);
  return null;
}

export interface SingleListingMapInnerProps {
  latitude: number;
  longitude: number;
  /** Null when the seller withheld price — the pin then shows a neutral label, never `$0`. */
  price: number | null;
  listingType: ListingType;
  className?: string;
}

export default function SingleListingMapInner({
  latitude,
  longitude,
  price,
  listingType,
  className,
}: SingleListingMapInnerProps) {
  const PILL_W = 80;
  const PILL_H = 32;
  const { failed: tilesFailed, onTileError } = useTileFailure();
  const { tileUrl, attribution } = useTileLayerConfig();
  const priceDisplay = formatListingPrice(price, listingType);
  const pinLabel = priceDisplay.isWithheld ? 'View listing' : priceDisplay.text;
  const icon = L.divIcon({
    className: 'cribstop-price-marker',
    // `micro-label` (12px/700) in the app's own typeface — this was 13px in hardcoded `Inter`,
    // the stack's fallback rather than the face the app ships. See `ListingsMapInner`.
    html: `<span style="background:#FF385C;color:#fff;display:inline-flex;align-items:center;justify-content:center;min-width:${PILL_W}px;height:${PILL_H}px;padding:0 12px;border-radius:9999px;border:2px solid #fff;font:700 12px/1 'Manrope Variable','Inter Variable',system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);white-space:nowrap;">${pinLabel}</span>`,
    iconSize: [PILL_W, PILL_H],
    iconAnchor: [PILL_W / 2, PILL_H / 2],
  });

  return (
    <div className={`relative isolate ${className ?? ''}`}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={14}
        // Set here, not only on `<TileLayer>` — see `ListingsMapInner` for why. This map has no
        // marker clustering, so it does not hit that crash, but the tile URL still arrives
        // asynchronously and the map should not be able to zoom past the provider's coverage
        // before `<TileLayer>` mounts.
        maxZoom={19}
        scrollWheelZoom={false}
        zoomControl
        className="h-full w-full"
        style={{ background: '#f2ede6' }}
      >
        {/* Empty until `/api/map-config` answers — see `map-tiles.ts` for why this never
            defaults to a fallback URL client-side. */}
        {tileUrl && (
          <TileLayer
            attribution={attribution}
            url={tileUrl}
            eventHandlers={{ tileerror: onTileError }}
          />
        )}
        <InvalidateOnMount />
        <Circle
          center={[latitude, longitude]}
          radius={350}
          pathOptions={{
            color: '#FF385C',
            fillColor: '#FF385C',
            fillOpacity: 0.12,
            weight: 1,
          }}
        />
        <Marker position={[latitude, longitude]} icon={icon} />
      </MapContainer>
      {/* Tiles failed to load — surface it rather than a silent blank map (#291). The pin above
          still carries the real price, so this only calls out the missing basemap imagery. */}
      {tilesFailed && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-[400] rounded-2xl bg-ink/85 px-3 py-1.5 text-center text-[11px] font-semibold text-white shadow-card backdrop-blur">
          Map imagery is temporarily unavailable.
        </div>
      )}
    </div>
  );
}
