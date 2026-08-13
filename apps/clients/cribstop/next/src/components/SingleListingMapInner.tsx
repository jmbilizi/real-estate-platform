'use client';

import { useEffect } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ListingType } from '@/lib/types';
import { formatListingPrice } from '@/lib/listing-format';

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
  const priceDisplay = formatListingPrice(price, listingType);
  const pinLabel = priceDisplay.isWithheld ? 'View listing' : priceDisplay.text;
  const icon = L.divIcon({
    className: 'cribstop-price-marker',
    html: `<span style="background:#FF385C;color:#fff;display:inline-flex;align-items:center;justify-content:center;min-width:${PILL_W}px;height:${PILL_H}px;padding:0 12px;border-radius:9999px;border:2px solid #fff;font:700 13px/1 Inter,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);white-space:nowrap;">${pinLabel}</span>`,
    iconSize: [PILL_W, PILL_H],
    iconAnchor: [PILL_W / 2, PILL_H / 2],
  });

  return (
    <div className={`isolate ${className ?? ''}`}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={14}
        scrollWheelZoom={false}
        zoomControl
        className="h-full w-full"
        style={{ background: '#f2ede6' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
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
    </div>
  );
}
