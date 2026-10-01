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
/** Icon box. Every mode keeps this tap target, so a dot is as easy to hit as a pill. */
const HIT = 44;
const PILL_H = 30;
const DOT = 14;
const TAP_DEDUPE_MS = 500;
/** Tailwind `sm`. Below it, markers start as count bubbles. */
const SM_PX = 640;
const OVERLAP_GAP = 2;

/** "Shaw · 42". The count only. Long names are cut, and the full name stays in the aria label. */
export function neighborhoodMarkerLabel(name: string, total: number): string {
  const short = name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
  return `${short} · ${total.toLocaleString()}`;
}

/**
 * How a marker draws: `full` is the name and count, `bubble` is the count only, `dot` is a small
 * dot with no text. The mode is display only. It never changes which markers exist.
 */
export type MarkerMode = 'full' | 'bubble' | 'dot';

export interface LayoutItem {
  key: string;
  name: string;
  total: number;
  /** Position in screen pixels. */
  x: number;
  y: number;
}

function markerSize(item: LayoutItem, mode: MarkerMode): { w: number; h: number } {
  if (mode === 'dot') return { w: DOT, h: DOT };
  if (mode === 'bubble') {
    return { w: Math.max(PILL_H, item.total.toLocaleString().length * 8 + 20), h: PILL_H };
  }
  return {
    w: Math.round(neighborhoodMarkerLabel(item.name, item.total).length * 7.4) + 24,
    h: PILL_H,
  };
}

/**
 * Overlap avoidance. Markers are placed in order of count, high to low (ties by key), so the one
 * with the higher count keeps the fuller form. Each marker takes the first form that does not
 * overlap one already placed, and a dot is always accepted. `compactOnly` starts at the bubble.
 * Pure: call it again after every zoom.
 */
export function layoutNeighborhoodMarkers(
  items: readonly LayoutItem[],
  compactOnly: boolean,
): Map<string, MarkerMode> {
  const order = [...items].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const forms: MarkerMode[] = compactOnly ? ['bubble', 'dot'] : ['full', 'bubble', 'dot'];
  const placed: { l: number; r: number; t: number; b: number }[] = [];
  const result = new Map<string, MarkerMode>();
  for (const item of order) {
    let chosen: MarkerMode = 'dot';
    let box = { l: 0, r: 0, t: 0, b: 0 };
    for (const mode of forms) {
      const { w, h } = markerSize(item, mode);
      box = { l: item.x - w / 2, r: item.x + w / 2, t: item.y - h / 2, b: item.y + h / 2 };
      const clear = !placed.some(
        (p) =>
          box.l < p.r + OVERLAP_GAP &&
          box.r + OVERLAP_GAP > p.l &&
          box.t < p.b + OVERLAP_GAP &&
          box.b + OVERLAP_GAP > p.t,
      );
      if (clear || mode === 'dot') {
        chosen = mode;
        break;
      }
    }
    placed.push(box);
    result.set(item.key, chosen);
  }
  return result;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const MARKER_FONT = "700 12px/1 'Manrope Variable','Inter Variable',system-ui,sans-serif";

/**
 * The icon is a fixed 44px box, so a mode or highlight change restyles the inner pill in place and
 * never replaces the element. A replaced element drops keyboard focus.
 */
function buildNeighborhoodIcon(row: NeighborhoodRow) {
  const pill = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;font:${MARKER_FONT};border:1.5px solid;box-shadow:0 4px 16px rgba(34,34,34,0.18),0 1.5px 8px rgba(0,0,0,0.08);white-space:nowrap;transition:transform .15s;`;
  return L.divIcon({
    className: 'cribstop-neighborhood-marker',
    html: `<span style="display:block;position:relative;width:${HIT}px;height:${HIT}px;cursor:pointer;"><span style="${pill}">${escapeHtml(neighborhoodMarkerLabel(row.name, row.total))}</span></span>`,
    iconSize: [HIT, HIT],
    iconAnchor: [HIT / 2, HIT / 2],
  });
}

function pillOf(marker: L.Marker | undefined): HTMLElement | null {
  return (marker?.getElement()?.firstElementChild?.firstElementChild as HTMLElement | null) ?? null;
}

function paintMarker(
  marker: L.Marker | undefined,
  row: NeighborhoodRow,
  mode: MarkerMode,
  active: boolean,
) {
  const pill = pillOf(marker);
  if (!marker || !pill) return;
  const shown: MarkerMode = active ? 'full' : mode;
  pill.textContent =
    shown === 'full'
      ? neighborhoodMarkerLabel(row.name, row.total)
      : shown === 'bubble'
        ? row.total.toLocaleString()
        : '';
  pill.style.height = `${shown === 'dot' ? DOT : PILL_H}px`;
  pill.style.width = shown === 'dot' ? `${DOT}px` : '';
  pill.style.minWidth = shown === 'bubble' ? `${PILL_H}px` : '';
  pill.style.padding = shown === 'dot' ? '0' : shown === 'bubble' ? '0 8px' : '0 10px';
  pill.style.borderRadius = '9999px';
  pill.style.background = active ? '#FF385C' : '#fff';
  pill.style.color = active ? '#fff' : '#222';
  pill.style.borderColor = active ? '#FF385C' : 'rgba(0,0,0,.15)';
  pill.style.transform = `translate(-50%,-50%)${active ? ' scale(1.1)' : ''}`;
  marker.setZIndexOffset(active ? 1000 : 0);
}

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/**
 * One count marker per neighborhood on the current page of groups (#503). The markers follow the
 * cards, not the viewport: moving the map never changes the set.
 *
 * Display: below `sm` a marker is a count bubble, and from `sm` up it is the name and count. The
 * highlighted marker always shows its name. Where markers overlap on screen, the higher count keeps
 * the fuller form and the others shrink to a bubble or a dot, recomputed after every zoom.
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
  const modesRef = useRef<Map<string, MarkerMode>>(new Map());
  const rowsRef = useRef(rows);
  const previewedAt = useRef(0);
  const activeRef = useRef(activeKey);
  activeRef.current = activeKey;
  const cb = useRef({ onActive, onSelect, onTapPreview });
  cb.current = { onActive, onSelect, onTapPreview };

  useEffect(() => {
    rowsRef.current = rows;
    const layer = L.layerGroup();
    const markers = new Map<string, L.Marker>();
    for (const row of rows) {
      const marker = L.marker([row.centroid.lat, row.centroid.lng], {
        icon: buildNeighborhoodIcon(row),
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

    const relayout = () => {
      const items: LayoutItem[] = rows.map((row) => {
        const p = map.latLngToContainerPoint([row.centroid.lat, row.centroid.lng]);
        return { key: row.key, name: row.name, total: row.total, x: p.x, y: p.y };
      });
      modesRef.current = layoutNeighborhoodMarkers(items, window.innerWidth < SM_PX);
      for (const row of rows) {
        paintMarker(
          markers.get(row.key),
          row,
          modesRef.current.get(row.key) ?? 'dot',
          activeRef.current === row.key,
        );
      }
    };
    relayout();
    map.on('zoomend moveend resize', relayout);
    window.addEventListener('resize', relayout);

    const clearOnMapTap = () => {
      if (isCoarsePointer()) cb.current.onActive(null);
    };
    map.on('click', clearOnMapTap);
    return () => {
      map.off('click', clearOnMapTap);
      map.off('zoomend moveend resize', relayout);
      window.removeEventListener('resize', relayout);
      map.removeLayer(layer);
      markersRef.current = new Map();
    };
  }, [rows, map]);

  // A highlight change repaints the previous and the new marker only.
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    const byKey = new Map(rowsRef.current.map((r) => [r.key, r]));
    for (const key of new Set([lastRef.current, activeKey])) {
      const row = key ? byKey.get(key) : undefined;
      if (!key || !row) continue;
      paintMarker(
        markersRef.current.get(key),
        row,
        modesRef.current.get(key) ?? 'dot',
        key === activeKey,
      );
    }
    lastRef.current = activeKey;
  }, [activeKey, rows]);

  return null;
}
