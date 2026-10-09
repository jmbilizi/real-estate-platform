import { searchRequestSchema } from '@cribstop/property-contracts';
import {
  areaBounds,
  areaToParam,
  drawnPathToRing,
  type LngLat,
  MAX_DRAWN_VERTICES,
  paramToArea,
  ringToGeoJson,
  simplifyLine,
} from './draw-area';

/** A noisy circle of `count` points around Alexandria, the way a finger draws one. */
const circle = (count: number, radius = 0.01): LngLat[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    return [-77.05 + Math.cos(angle) * radius * 1.3, 38.8 + Math.sin(angle) * radius] as LngLat;
  });

describe('drawnPathToRing', () => {
  it('simplifies a long freehand path to at most 100 vertices, closed', () => {
    const result = drawnPathToRing(circle(600));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.ring.length - 1).toBeLessThanOrEqual(MAX_DRAWN_VERTICES);
    expect(result.ring.length - 1).toBeGreaterThanOrEqual(3);
    expect(result.ring[0]).toEqual(result.ring[result.ring.length - 1]);
  });

  it('keeps the shape close to what was drawn', () => {
    const result = drawnPathToRing(circle(600));
    if (result.status !== 'ok') throw new Error('expected a ring');
    const bounds = areaBounds(ringToGeoJson(result.ring));
    expect(bounds?.west).toBeCloseTo(-77.05 - 0.013, 3);
    expect(bounds?.north).toBeCloseTo(38.8 + 0.01, 3);
  });

  it('produces a shape the service accepts', () => {
    const result = drawnPathToRing(circle(600));
    if (result.status !== 'ok') throw new Error('expected a ring');
    const area = ringToGeoJson(result.ring);
    expect(searchRequestSchema.safeParse({ area }).success).toBe(true);
  });

  it('rounds to five decimals', () => {
    const result = drawnPathToRing([
      [-77.0512349, 38.8000049],
      [-77.0412349, 38.8000049],
      [-77.0412349, 38.9000049],
    ]);
    if (result.status !== 'ok') throw new Error('expected a ring');
    expect(result.ring[0]).toEqual([-77.05123, 38.8]);
  });

  it('discards fewer than three distinct points', () => {
    expect(drawnPathToRing([])).toEqual({ status: 'too-small' });
    expect(drawnPathToRing([[-77.05, 38.8]])).toEqual({ status: 'too-small' });
    expect(
      drawnPathToRing([
        [-77.05, 38.8],
        [-77.05, 38.8],
        [-77.04, 38.8],
        [-77.04, 38.8],
      ]),
    ).toEqual({ status: 'too-small' });
  });

  it('discards a zero-area line', () => {
    expect(
      drawnPathToRing([
        [-77.05, 38.8],
        [-77.04, 38.8],
        [-77.03, 38.8],
        [-77.02, 38.8],
      ]),
    ).toEqual({ status: 'too-small' });
  });

  it('refuses a figure of eight rather than guessing', () => {
    const eight: LngLat[] = [
      [0, 0],
      [0.02, 0.03],
      [0.02, 0],
      [0, 0.02],
    ];
    expect(drawnPathToRing(eight)).toEqual({ status: 'crossed' });
  });

  it('refuses a shape wider than the service accepts', () => {
    expect(drawnPathToRing(circle(60, 12))).toEqual({ status: 'too-large' });
  });

  it('names a shape that is too detailed, not crossed, when no tolerance fits it in 100 vertices', () => {
    // A zigzag with 400 teeth does not cross itself, and no tolerance up to 3% of its size merges them.
    const teeth: LngLat[] = [];
    for (let i = 0; i < 400; i++) teeth.push([i * 0.0001, i % 2 === 0 ? 0 : 0.05]);
    teeth.push([0.04, 0.2], [0, 0.2]);
    expect(drawnPathToRing(teeth)).toEqual({ status: 'too-complex' });
  });

  it('repairs a small overlap where the line meets its start', () => {
    const loop = circle(80);
    const overshoot: LngLat[] = [
      ...loop,
      [loop[0]![0] + 0.0003, loop[0]![1] - 0.0002],
      [loop[1]![0] + 0.0001, loop[1]![1] - 0.0001],
    ];
    expect(drawnPathToRing(overshoot).status).toBe('ok');
  });
});

describe('simplifyLine', () => {
  it('keeps the ends and drops points inside the tolerance', () => {
    const line: LngLat[] = [
      [0, 0],
      [1, 0.001],
      [2, 0],
      [3, 2],
    ];
    expect(simplifyLine(line, 0.01)).toEqual([
      [0, 0],
      [2, 0],
      [3, 2],
    ]);
  });
});

describe('the URL form', () => {
  const ring: LngLat[] = [
    [-77.06, 38.79],
    [-77.04, 38.79],
    [-77.04, 38.81],
    [-77.06, 38.81],
    [-77.06, 38.79],
  ];

  it('writes lng,lat pairs with five decimals and no closing point', () => {
    expect(areaToParam(ringToGeoJson(ring))).toBe(
      '-77.06000,38.79000;-77.04000,38.79000;-77.04000,38.81000;-77.06000,38.81000',
    );
  });

  it('round-trips through the URL', () => {
    const area = ringToGeoJson(ring);
    const param = areaToParam(area) as string;
    expect(paramToArea(param)).toBe(area);
    expect(areaToParam(paramToArea(param) as string)).toBe(param);
  });

  it('drops a value the service would refuse', () => {
    expect(paramToArea('')).toBeUndefined();
    expect(paramToArea('-77.06,38.79;-77.04,38.79')).toBeUndefined();
    expect(paramToArea('a,b;c,d;e,f')).toBeUndefined();
    expect(paramToArea('-200,38.79;-77.04,38.79;-77.04,38.81')).toBeUndefined();
    expect(paramToArea('0,0;2,2;2,0;0,2')).toBeUndefined();
    expect(paramToArea('0,0;1,1;2,2')).toBeUndefined();
    const many = Array.from({ length: 250 }, (_, i) => `${-77 + i / 1e4},38.8`).join(';');
    expect(paramToArea(many)).toBeUndefined();
  });

  it('fits within a short URL at 100 vertices', () => {
    const result = drawnPathToRing(circle(600));
    if (result.status !== 'ok') throw new Error('expected a ring');
    const param = areaToParam(ringToGeoJson(result.ring)) as string;
    expect(param.length).toBeLessThan(2600);
  });
});

describe('areaBounds', () => {
  it('is the bounding box of the ring', () => {
    expect(
      areaBounds(
        ringToGeoJson([
          [-77.06, 38.79],
          [-77.04, 38.79],
          [-77.05, 38.82],
          [-77.06, 38.79],
        ]),
      ),
    ).toEqual({ west: -77.06, south: 38.79, east: -77.04, north: 38.82 });
  });
});
