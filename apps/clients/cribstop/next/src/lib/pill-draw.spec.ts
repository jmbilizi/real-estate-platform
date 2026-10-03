import { PILL_BOX_H } from './map-pins';
import { drawPill, pillBounds, pillContains, pillGeometry } from './pill-draw';

const NOT_MOVED = { dx: 0, dy: 0 };

function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const ctx = new Proxy(
    {},
    {
      get:
        (_target, name: string) =>
        (...args: unknown[]) => {
          calls.push([name, args]);
        },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('pillGeometry (#549)', () => {
  it('puts the tail tip on the coordinate and the body above it', () => {
    const g = pillGeometry(100, 200, '$585K', NOT_MOVED);

    expect([g.tailX, g.tailY]).toEqual([100, 200]);
    expect([g.tipX, g.tipY]).toEqual([100, 200]);
    expect(g.bottom).toBeLessThan(200);
    expect(g.right - g.left).toBeGreaterThanOrEqual(44);
  });

  it('moves the body and the tail with the offset and leaves the true point', () => {
    const g = pillGeometry(100, 200, '$585K', { dx: 30, dy: -28 });

    expect([g.tailX, g.tailY]).toEqual([130, 172]);
    expect([g.tipX, g.tipY]).toEqual([100, 200]);
  });
});

describe('pillContains (#549)', () => {
  const g = pillGeometry(100, 200, '$585K', NOT_MOVED);
  const cx = g.tailX;

  it('gives a pill with room a hit area of the full 44px box', () => {
    expect(pillContains(g, true, cx, g.top - 8)).toBe(true);
    expect(pillContains(g, true, cx, g.tailY)).toBe(true);
    expect(g.tailY - (g.top - 9)).toBe(PILL_BOX_H);
    expect(pillContains(g, true, cx, g.top - 10)).toBe(false);
  });

  it('gives a crowded pill only its visible body and tail', () => {
    expect(pillContains(g, false, cx, g.top - 8)).toBe(false);
    expect(pillContains(g, false, cx, g.top + 2)).toBe(true);
    expect(pillContains(g, false, cx, g.tailY - 1)).toBe(true);
  });

  it('misses a point beside the pill', () => {
    expect(pillContains(g, true, g.right + 5, g.top + 10)).toBe(false);
  });
});

describe('pillBounds (#549)', () => {
  it('holds the hover ring of the widest pill, so a redraw clears all of it', () => {
    const g = pillGeometry(100, 200, '$2,500/mo', NOT_MOVED);
    const [minX, minY, maxX, maxY] = pillBounds(g);
    const half = (g.right - g.left) / 2;
    // The active pill is 1.1 times larger about its tail tip, with a 4px ring.
    const reach = (half + 4) * 1.1;

    expect(g.tailX - minX).toBeGreaterThanOrEqual(reach);
    expect(maxX - g.tailX).toBeGreaterThanOrEqual(reach);
    expect(g.tailY - minY).toBeGreaterThanOrEqual((g.tailY - g.top + 4) * 1.1);
    expect(maxY).toBeGreaterThan(g.tailY);
  });

  it('holds the leader line of a moved pill', () => {
    const g = pillGeometry(100, 200, '$585K', { dx: 60, dy: -90 });
    const [minX, , , maxY] = pillBounds(g);

    expect(minX).toBeLessThanOrEqual(100);
    expect(maxY).toBeGreaterThanOrEqual(200);
  });
});

describe('drawPill (#549)', () => {
  it('draws the price of every pill and no dot for an unmoved pill', () => {
    const { ctx, calls } = recorder();
    drawPill(ctx, pillGeometry(100, 200, '$585K', NOT_MOVED), '$585K', 'plain');

    expect(calls.filter(([name]) => name === 'fillText').map(([, args]) => args[0])).toEqual([
      '$585K',
    ]);
    expect(calls.some(([name]) => name === 'arc')).toBe(false);
  });

  it('draws a leader line and a dot on the true point for a moved pill', () => {
    const { ctx, calls } = recorder();
    drawPill(ctx, pillGeometry(100, 200, '$585K', { dx: 0, dy: -14 }), '$585K', 'plain');

    const arcs = calls.filter(([name]) => name === 'arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0][1].slice(0, 2)).toEqual([100, 200]);
  });

  it('draws a ring and a scale for the hovered pill, and restores the context', () => {
    const { ctx, calls } = recorder();
    drawPill(ctx, pillGeometry(100, 200, '$585K', NOT_MOVED), '$585K', 'active');
    const names = calls.map(([name]) => name);

    expect(names).toContain('scale');
    expect(names.filter((name) => name === 'save')).toHaveLength(1);
    expect(names.filter((name) => name === 'restore')).toHaveLength(1);
  });
});
