import { z } from 'zod';

/** #747. Caps for a user-drawn `area`. The web simplifies to 100 vertices, so 200 is headroom. */
export const MAX_AREA_VERTICES = 200;
export const MAX_AREA_CHARS = 8000;
/** The widest a drawn shape may be, in degrees of longitude or latitude. A city is under 1. */
export const MAX_AREA_SPAN_DEGREES = 20;

type Point = readonly [number, number];

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function inBox(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** True when the closed segments ab and cd share at least one point. */
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && inBox(a, b, c)) ||
    (d2 === 0 && inBox(a, b, d)) ||
    (d3 === 0 && inBox(c, d, a)) ||
    (d4 === 0 && inBox(c, d, b))
  );
}

/**
 * Whether a closed ring is a simple polygon with area: no zero-length segment, no back-tracking
 * spike, no segment that touches a non-adjacent segment, and a non-zero area. Pure, so the web app
 * uses the same test to discard a shape the service would refuse. The test is planar in lng/lat. That
 * is exact enough for a city-sized shape, where geodesic and planar edges agree.
 */
export function isSimpleRing(ring: readonly Point[]): boolean {
  const n = ring.length - 1; // The last point repeats the first.
  if (n < 3) return false;
  const pts = ring.slice(0, n);
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Point;
    const b = pts[(i + 1) % n] as Point;
    const c = pts[(i + 2) % n] as Point;
    if (a[0] === b[0] && a[1] === b[1]) return false;
    area2 += a[0] * b[1] - b[0] * a[1];
    const spike =
      cross(a, b, c) === 0 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0;
    if (spike) return false;
  }
  if (area2 === 0) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // Adjacent through the closing point.
      if (
        segmentsTouch(
          pts[i] as Point,
          pts[(i + 1) % n] as Point,
          pts[j] as Point,
          pts[(j + 1) % n] as Point,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

const coordinate = (min: number, max: number) => z.number().min(min).max(max);

/**
 * A GeoJSON `Polygon` string: one closed ring, simple, at most `MAX_AREA_VERTICES` points and
 * `MAX_AREA_CHARS` characters. Validated here so a bad shape is a 400, never a PostGIS error.
 */
export const areaPolygon = z
  .string()
  .max(MAX_AREA_CHARS, `must not exceed ${MAX_AREA_CHARS} characters`)
  .superRefine((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
      return;
    }
    const shape = z
      .strictObject({
        type: z.literal('Polygon'),
        coordinates: z.tuple([z.array(z.tuple([coordinate(-180, 180), coordinate(-90, 90)]))]),
      })
      .safeParse(parsed);
    if (!shape.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be a GeoJSON Polygon with one ring of valid [lng, lat] points',
      });
      return;
    }
    const ring = shape.data.coordinates[0];
    if (ring.length > MAX_AREA_VERTICES) {
      ctx.addIssue({ code: 'custom', message: `must not exceed ${MAX_AREA_VERTICES} points` });
      return;
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length < 4 || !first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      ctx.addIssue({
        code: 'custom',
        message: 'ring must be closed with at least 3 distinct points',
      });
      return;
    }
    // The ring test is planar and the service reads edges as geodesics. They agree for a shape of
    // city or county size, so a continental shape is refused rather than guessed at.
    const lngs = ring.map((point) => point[0]);
    const lats = ring.map((point) => point[1]);
    const span = Math.max(
      Math.max(...lngs) - Math.min(...lngs),
      Math.max(...lats) - Math.min(...lats),
    );
    if (span > MAX_AREA_SPAN_DEGREES) {
      ctx.addIssue({
        code: 'custom',
        message: `must not span more than ${MAX_AREA_SPAN_DEGREES} degrees`,
      });
      return;
    }
    if (!isSimpleRing(ring)) {
      ctx.addIssue({
        code: 'custom',
        message: 'ring must not intersect itself and must have an area',
      });
    }
  })
  .describe(
    'A drawn shape: GeoJSON Polygon as a JSON string, one closed ring. Only listings inside it ' +
      'match. ANDed with every other filter, including `boundary` and `bounds`. A listing whose ' +
      'street address is withheld has no coordinates and never matches. Capped at ' +
      `${MAX_AREA_VERTICES} points, ${MAX_AREA_CHARS} characters and ${MAX_AREA_SPAN_DEGREES} ` +
      'degrees across. A self-intersecting or zero-area shape is a 400.',
  );
