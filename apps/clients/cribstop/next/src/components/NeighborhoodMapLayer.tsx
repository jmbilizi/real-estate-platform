'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { NeighborhoodRow } from '@cribstop/property-contracts';

export type MappableNeighborhood = NeighborhoodRow & { centroid: { lat: number; lng: number } };

/** A row with no centroid gets no marker. There is no fallback coordinate (#503). */
export function selectMappableNeighborhoods(
  rows: readonly NeighborhoodRow[],
): MappableNeighborhood[] {
  return rows.filter((row): row is MappableNeighborhood => row.centroid !== null);
}

const NAME_MAX = 18;
const HIT = 44;
const TAP_DEDUPE_MS = 500;

/** "Shaw · 42". The count only. Long names are cut, and the full name stays in the aria label. */
export function neighborhoodMarkerLabel(name: string, total: number): string {
  const short = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
  return `${short} · ${total.toLocaleString()}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const MARKER_FONT = "700 12px/1 'Manrope Variable','Inter Variable',system-ui,sans-serif";

/**
 * Same pill as the listing price pins. The icon box is 44px tall so the tap target meets the
 * minimum. The pill itself stays 30px.
 */
function buildNeighborhoodIcon(row: NeighborhoodRow, active: boolean) {
  const label = neighborhoodMarkerLabel(row.name, row.total);
  const width = Math.max(HIT, Math.round(label.length * 7.4) + 28);
  const tone = active
    ? 'background:#FF385C;color:#fff;border-color:#FF385C;transform:scale(1.1);'
    : 'background:#fff;color:#222;border-color:rgba(0,0,0,.15);';
  return L.divIcon({
    className: 'cribstop-neighborhood-marker',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${width}px;height:${HIT}px;cursor:pointer;"><span style="${tone}display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 10px;border-radius:9999px;border:1.5px solid;font:${MARKER_FONT};box-shadow:0 4px 16px rgba(34,34,34,0.18),0 1.5px 8px rgba(0,0,0,0.08);white-space:nowrap;transition:transform .15s;">${escapeHtml(label)}</span></span>`,
    iconSize: [width, HIT],
    iconAnchor: [width / 2, HIT / 2],
  });
}

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * One count marker per neighborhood on the current page of groups (#503). The markers follow the
 * cards, not the viewport: moving the map never changes the set.
 *
 * Pointer devices: hover and focus link a marker to its card, and a click drills down. Touch
 * devices: the first tap highlights the marker and scrolls its card into view. A tap on the
 * highlighted marker drills down.
 */
export default function NeighborhoodMapLayer({
  rows,
  activeKey,
  onActive,
  onSelect,
  onTapPreview,
}: {
  rows: readonly MappableNeighborhood[];
  activeKey: string | null;
  onActive: (key: string | null) => void;
  onSelect: (row: NeighborhoodRow) => void;
  /** Touch only: reveal the card for a first tap. */
  onTapPreview?: (key: string) => void;
}) {
  const map = useMap();
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const previewedAt = useRef(0);
  const activeRef = useRef(activeKey);
  activeRef.current = activeKey;
  const cb = useRef({ onActive, onSelect, onTapPreview });
  cb.current = { onActive, onSelect, onTapPreview };

  useEffect(() => {
    const layer = L.layerGroup();
    const markers = new Map<string, L.Marker>();
    for (const row of rows) {
      const marker = L.marker([row.centroid.lat, row.centroid.lng], {
        icon: buildNeighborhoodIcon(row, activeRef.current === row.key),
        title: `${row.name}, ${row.city}, ${row.state}: ${row.total.toLocaleString()} homes`,
        alt: `${row.name}, ${row.total.toLocaleString()} homes`,
        keyboard: true,
      });
      marker.on('mouseover', () => {
        if (!isCoarsePointer()) cb.current.onActive(row.key);
      });
      marker.on('mouseout', () => {
        if (!isCoarsePointer()) cb.current.onActive(null);
      });
      marker.on('add', () => {
        const el = marker.getElement();
        // A tap focuses the element too. Only keyboard focus links the card, or a first tap
        // would already count as the second.
        el?.addEventListener('focus', () => {
          if (el.matches(':focus-visible')) cb.current.onActive(row.key);
        });
        el?.addEventListener('blur', () => cb.current.onActive(null));
      });
      marker.on('click', () => {
        if (isCoarsePointer()) {
          // Leaflet can dispatch one touch tap as two clicks. The second must not drill.
          const now = Date.now();
          if (now - previewedAt.current < TAP_DEDUPE_MS) return;
          if (activeRef.current !== row.key) {
            previewedAt.current = now;
            cb.current.onActive(row.key);
            cb.current.onTapPreview?.(row.key);
            return;
          }
        }
        cb.current.onSelect(row);
      });
      markers.set(row.key, marker);
      layer.addLayer(marker);
    }
    markersRef.current = markers;
    layer.addTo(map);
    const clearOnMapTap = () => {
      if (isCoarsePointer()) cb.current.onActive(null);
    };
    map.on('click', clearOnMapTap);
    return () => {
      map.off('click', clearOnMapTap);
      map.removeLayer(layer);
      markersRef.current = new Map();
    };
  }, [rows, map]);

  // A highlight change restyles the pill in place and never replaces the icon, because a
  // replaced element drops keyboard focus.
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    for (const key of new Set([lastRef.current, activeKey])) {
      if (!key) continue;
      const marker = markersRef.current.get(key);
      const pill = marker?.getElement()?.firstElementChild?.firstElementChild as
        | HTMLElement
        | null
        | undefined;
      if (!marker || !pill) continue;
      const on = key === activeKey;
      pill.style.background = on ? '#FF385C' : '#fff';
      pill.style.color = on ? '#fff' : '#222';
      pill.style.borderColor = on ? '#FF385C' : 'rgba(0,0,0,.15)';
      pill.style.transform = on ? 'scale(1.1)' : '';
      marker.setZIndexOffset(on ? 1000 : 0);
    }
    lastRef.current = activeKey;
  }, [activeKey, rows]);

  return null;
}
