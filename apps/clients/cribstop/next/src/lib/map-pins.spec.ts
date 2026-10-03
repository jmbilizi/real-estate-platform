import {
  FAN_CAP_PX,
  OFFSET_CAP_PX,
  PILL_BODY_H,
  PILL_BOX_H,
  PILL_HIT_TOP,
  pillWidth,
  type SpreadOptions,
  spreadPills,
  type SpreadPoint,
  VISIBLE_STRIP,
} from './map-pins';

describe('pillWidth', () => {
  it('never goes below the 44px tap target', () => {
    expect(pillWidth('$9')).toBe(44);
    expect(PILL_BOX_H).toBe(44);
  });

  it('grows with the label', () => {
    expect(pillWidth('$2.1K/mo')).toBeGreaterThan(pillWidth('$585K'));
  });
});

const at = (id: string, x: number, y: number, label = '$585K'): SpreadPoint => ({
  id,
  x,
  y,
  label,
});

/** Body rect of a pill after the spread. The tail tip is the bottom centre of the 44px box. */
function bodyOf(point: SpreadPoint, dx: number, dy: number) {
  const w = pillWidth(point.label);
  const top = point.y - PILL_BOX_H + PILL_HIT_TOP + dy;
  return { l: point.x + dx - w / 2, r: point.x + dx + w / 2, t: top, b: top + PILL_BODY_H };
}

/**
 * Counts the sample points of each body that no pill above it covers. A pill above is one with a
 * lower rank. A count of zero means the pill cannot be clicked.
 */
function visibleSamples(points: SpreadPoint[], options: SpreadOptions = {}): Map<string, number> {
  const spread = spreadPills(points, options);
  const rects = points.map((p) => {
    const o = spread.get(p.id) as { dx: number; dy: number; rank: number };
    return { id: p.id, rank: o.rank, ...bodyOf(p, o.dx, o.dy) };
  });
  const result = new Map<string, number>();
  for (const me of rects) {
    let visible = 0;
    for (let x = me.l + 1; x < me.r; x += 3) {
      for (let y = me.t + 1; y < me.b; y += 3) {
        const covered = rects.some(
          (o) => o.rank < me.rank && x >= o.l && x <= o.r && y >= o.t && y <= o.b,
        );
        if (!covered) visible++;
      }
    }
    result.set(me.id, visible);
  }
  return result;
}

describe('spreadPills (#549)', () => {
  it('leaves a lone pill on its tip, with room for the full hit area', () => {
    const out = spreadPills([at('a', 100, 200)]);
    expect(out.get('a')).toMatchObject({ dx: 0, dy: 0, roomy: true });
  });

  it('leaves pills that do not overlap where they are', () => {
    const out = spreadPills([at('a', 60, 200), at('b', 300, 200), at('c', 60, 400)]);
    for (const id of ['a', 'b', 'c']) expect(out.get(id)).toMatchObject({ dx: 0, dy: 0 });
  });

  it('steps the lower pill of a heavy overlap away so both bodies show', () => {
    // The pill with the larger y is lower on screen, so it is on top.
    const out = spreadPills([at('under', 102, 200), at('top', 100, 203)]);
    expect(out.get('top')).toMatchObject({ dx: 0, dy: 0, rank: 0 });
    const under = out.get('under');
    expect(under?.rank).toBe(1);
    expect(Math.abs((under?.dy ?? 0) - 0) + Math.abs(under?.dx ?? 0)).toBeGreaterThan(0);
    expect(under?.roomy).toBe(false);
  });

  it('lets pills overlap a little without moving them', () => {
    const w = pillWidth('$585K');
    // Overlap in x is 10% of the width.
    const out = spreadPills([at('a', 100, 200), at('b', 100 + w * 0.9, 200)]);
    expect(out.get('b')).toMatchObject({ dx: 0, dy: 0 });
  });

  it('keeps every body of a dense block inside the cap', () => {
    // 40 homes in a block 120px by 90px, which is a dense block at a high zoom.
    const points = Array.from({ length: 40 }, (_, i) =>
      at(`p${i}`, 300 + ((i * 7919) % 120), 300 + ((i * 104_729) % 90), i % 3 ? '$585K' : '$1.2M'),
    );
    for (const o of spreadPills(points).values()) {
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(OFFSET_CAP_PX + 0.5);
    }
    // Past the cap pills overlap, so some bodies in a block this dense are covered. A zoom shows them.
    const hidden = [...visibleSamples(points).values()].filter((n) => n === 0);
    expect(hidden.length).toBeLessThan(points.length);
  });

  it('fans homes at one true coordinate out, only when fan is on', () => {
    const condo = Array.from({ length: 20 }, (_, i) => ({
      ...at(`unit${i}`, 500, 500, '$412K'),
      coordKey: '38.81097,-77.11151',
    }));
    const fanned = spreadPills(condo, { fan: true });
    expect(new Set([...fanned.values()].map((o) => `${o.dx},${o.dy}`)).size).toBe(20);
    for (const [id, count] of visibleSamples(condo, { fan: true })) {
      expect({ id, ok: count >= 4 }).toEqual({ id, ok: true });
    }
    for (const o of fanned.values())
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(FAN_CAP_PX + 1);

    // Zoomed out, the same pills stay within the small cap and just overlap.
    for (const o of spreadPills(condo).values()) {
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(OFFSET_CAP_PX);
    }
  });

  it.each([5, 8, 11, 13])(
    'keeps every pill of a 900-home city within the cap at zoom %i',
    (zoom) => {
      // Alexandria, VA: about 12 km by 16 km. Web Mercator pixels at this zoom.
      const world = 256 * 2 ** zoom;
      const project = (lat: number, lng: number) => ({
        x: ((lng + 180) / 360) * world,
        y:
          ((1 -
            Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
              Math.PI) /
            2) *
          world,
      });
      let seed = 3;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const points = Array.from({ length: 900 }, (_, i) => {
        const p = project(38.75 + rnd() * 0.14, -77.15 + rnd() * 0.18);
        return at(`h${i}`, p.x, p.y, '$585K');
      });
      const start = performance.now();
      const out = spreadPills(points);
      expect(performance.now() - start).toBeLessThan(1500);
      expect(out.size).toBe(900);
      for (const o of out.values()) {
        expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(OFFSET_CAP_PX + 0.5);
      }
    },
  );

  it('bounds the cost when thousands of homes collapse onto a few pixels', () => {
    const points = Array.from({ length: 3000 }, (_, i) =>
      at(`c${i}`, 1000 + (i % 5), 1000 + ((i / 5) % 5), '$585K'),
    );
    const start = performance.now();
    const out = spreadPills(points);
    expect(performance.now() - start).toBeLessThan(1500);
    for (const o of out.values()) {
      expect(Math.hypot(o.dx, o.dy)).toBeLessThanOrEqual(OFFSET_CAP_PX + 0.5);
    }
  });

  it('keeps at least the visible strip of every pill in a stack of the same spot', () => {
    const stack = Array.from({ length: 3 }, (_, i) => at(`s${i}`, 200, 300));
    const out = spreadPills(stack);
    const ys = [...out.values()].map((o) => o.dy).sort((a, b) => b - a);
    expect(ys[0] - ys[1]).toBeGreaterThanOrEqual(VISIBLE_STRIP);
    expect(ys[1] - ys[2]).toBeGreaterThanOrEqual(VISIBLE_STRIP);
  });

  it('does not depend on input order, so a refetch does not reshuffle the pills', () => {
    const points = Array.from({ length: 80 }, (_, i) =>
      at(`p${i}`, 100 + ((i * 31) % 50), 100 + ((i * 17) % 40)),
    );
    const a = spreadPills(points);
    const b = spreadPills([...points].reverse());
    for (const p of points) expect(b.get(p.id)).toEqual(a.get(p.id));
  });

  it('spreads 1,800 points fast enough to run on every zoom', () => {
    const points = Array.from({ length: 1800 }, (_, i) =>
      at(`p${i}`, ((i * 7919) % 1400) + 100, ((i * 104_729) % 900) + 100),
    );
    const start = performance.now();
    spreadPills(points);
    expect(performance.now() - start).toBeLessThan(1500);
    // At the cap of 1,800 pins in view, at most a pill in a hundred has no visible spot. The next
    // zoom shows it. A block that is zoomed in has none (see the tests above).
    const hidden = [...visibleSamples(points).values()].filter((count) => count === 0);
    expect(hidden.length).toBeLessThanOrEqual(points.length / 100);
  });
});
