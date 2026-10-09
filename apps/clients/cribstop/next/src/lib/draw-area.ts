import { isSimpleRing, type MapBounds, MAX_AREA_VERTICES } from '@cribstop/property-contracts';

/**
 * The drawn area as a filter (#747). Pure helpers, so the draw gesture, the URL and the request
 * agree on one shape. A point is `[lng, lat]`. A ring is closed: the last point repeats the first.
 */

export type LngLat = [number, number];

/** The page URL parameter: `lng,lat;lng,lat;...`, five decimals, the ring open (no repeated point). */
export const AREA_PARAM = 'area';

/** The client simplifies a drawn line to at most this many vertices before it writes the URL. */
export const MAX_DRAWN_VERTICES = 100;

const DECIMALS = 5;
const round = (value: number): number => Number(value.toFixed(DECIMALS));

const samePoint = (a: LngLat, b: LngLat): boolean => a[0] === b[0] && a[1] === b[1];

/** Rounds to five decimals and drops a point equal to the one before it. */
function normalize(path: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const [lng, lat] of path) {
    const point: LngLat = [round(lng), round(lat)];
    const last = out[out.length - 1];
    if (!last || !samePoint(last, point)) out.push(point);
  }
  while (out.length > 1 && samePoint(out[0] as LngLat, out[out.length - 1] as LngLat)) out.pop();
  return out;
}

function distanceToSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open polyline. Keeps the first and last point. */
export function simplifyLine(points: readonly LngLat[], tolerance: number): LngLat[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(
        points[i] as LngLat,
        points[from] as LngLat,
        points[to] as LngLat,
      );
      if (d > farthestDistance) {
        farthest = i;
        farthestDistance = d;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([from, farthest], [farthest, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const close = (points: readonly LngLat[]): LngLat[] => [...points, points[0] as LngLat];

function signedArea(points: readonly LngLat[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as LngLat;
    const b = points[(i + 1) % points.length] as LngLat;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** Tolerances as a share of the shape's bounding-box diagonal, smallest first. */
const TOLERANCE_STEPS = [0, 0.0005, 0.001, 0.002, 0.004, 0.008, 0.016, 0.03];

export type DrawResult =
  | { status: 'ok'; ring: LngLat[] }
  | { status: 'too-small' }
  | { status: 'crossed' };

/**
 * A finger or mouse path as an area. The path closes when it ends. Fewer than three distinct
 * points, or no area, is `too-small`. A shape that crosses itself at every tolerance up to 3% of
 * its size is `crossed`: the service refuses such a shape, so the client does not send it.
 * Otherwise the path is simplified to at most 100 vertices, the smallest change that keeps the
 * outline simple.
 */
export function drawnPathToRing(path: readonly LngLat[]): DrawResult {
  const points = normalize(path);
  if (points.length < 3 || signedArea(points) === 0) return { status: 'too-small' };

  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const diagonal = Math.hypot(
    Math.max(...lngs) - Math.min(...lngs),
    Math.max(...lats) - Math.min(...lats),
  );

  for (const step of TOLERANCE_STEPS) {
    const simplified = normalize(step === 0 ? points : simplifyLine(points, diagonal * step));
    if (simplified.length < 3 || simplified.length > MAX_DRAWN_VERTICES) continue;
    if (signedArea(simplified) === 0) continue;
    const ring = close(simplified);
    if (isSimpleRing(ring)) return { status: 'ok', ring };
  }
  return { status: 'crossed' };
}

/** The ring as a GeoJSON Polygon string, the form the contract's `area` takes. */
export function ringToGeoJson(ring: readonly LngLat[]): string {
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
}

/** The ring of a GeoJSON Polygon string, or `null` when it is not a one-ring polygon. */
export function geoJsonToRing(area: string): LngLat[] | null {
  try {
    const parsed = JSON.parse(area) as { type?: unknown; coordinates?: unknown };
    if (parsed.type !== 'Polygon' || !Array.isArray(parsed.coordinates)) return null;
    const ring = parsed.coordinates[0] as unknown;
    if (!Array.isArray(ring)) return null;
    return ring as LngLat[];
  } catch {
    return null;
  }
}

/** The URL form of a GeoJSON area: `lng,lat;lng,lat;...`, the closing point left out. */
export function areaToParam(area: string): string | undefined {
  const ring = geoJsonToRing(area);
  if (!ring || ring.length < 4) return undefined;
  return ring
    .slice(0, -1)
    .map(([lng, lat]) => `${lng.toFixed(DECIMALS)},${lat.toFixed(DECIMALS)}`)
    .join(';');
}

const POINT = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

/**
 * A GeoJSON area from the URL form. A value the service would refuse (too many points, a range
 * error, a crossing or zero-area shape) is dropped, so a mangled link widens the search and never
 * becomes a 400 the app made.
 */
export function paramToArea(raw: string): string | undefined {
  const tokens = raw.split(';');
  if (tokens.length < 3 || tokens.length >= MAX_AREA_VERTICES) return undefined;
  if (!tokens.every((token) => POINT.test(token))) return undefined;
  const points = tokens.map((token) => token.split(',').map(Number) as LngLat);
  if (points.some(([lng, lat]) => Math.abs(lng) > 180 || Math.abs(lat) > 90)) return undefined;
  const ring = close(points.map(([lng, lat]) => [round(lng), round(lat)] as LngLat));
  return isSimpleRing(ring) ? ringToGeoJson(ring) : undefined;
}

/** The bounding box of an area. Used to fit the map and to ask the pin endpoint for the shape. */
export function areaBounds(area: string): MapBounds | null {
  const ring = geoJsonToRing(area);
  if (!ring || ring.length === 0) return null;
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}
