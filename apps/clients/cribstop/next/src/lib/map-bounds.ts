import type { MapBounds } from '@cribstop/property-contracts';

/**
 * The map view as a filter (#558). Pure helpers, so the URL, the request and the map agree on
 * one string form: `west,south,east,north`.
 */

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * A zoomed-out Leaflet view reports longitudes past ±180. The contract accepts only real ones, so
 * the edges are clamped. Five decimals is about one meter.
 */
export function formatBounds(bounds: MapBounds, decimals = 5): string {
  return [
    clamp(bounds.west, 180),
    clamp(bounds.south, 90),
    clamp(bounds.east, 180),
    clamp(bounds.north, 90),
  ]
    .map((edge) => edge.toFixed(decimals))
    .join(',');
}

/** Four decimals is about 11 meters. Pans below that are not a new filter. */
export const VIEWPORT_DECIMALS = 4;

/** The viewport the list filters on: clamped and rounded, so equal views compare equal. */
export function roundBounds(bounds: MapBounds): MapBounds {
  const [west, south, east, north] = formatBounds(bounds, VIEWPORT_DECIMALS).split(',').map(Number);
  return { west, south, east, north } as MapBounds;
}

export function sameBounds(a: MapBounds | undefined, b: MapBounds | undefined): boolean {
  if (!a || !b) return a === b;
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
}
