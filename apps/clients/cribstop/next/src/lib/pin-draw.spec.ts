import { drawHome, PIN_H, PIN_W, pinBounds, pinContains, pinGeometry } from './pin-draw';

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
      set: (_target, name: string, value: unknown) => {
        calls.push([`set:${name}`, [value]]);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('pin size (#557)', () => {
  it('is smaller than a Google Maps pin', () => {
    expect(PIN_W).toBeGreaterThanOrEqual(12);
    expect(PIN_W).toBeLessThanOrEqual(14);
    expect(PIN_H).toBeGreaterThanOrEqual(18);
    expect(PIN_H).toBeLessThanOrEqual(20);
  });
});

describe('pinGeometry', () => {
  it('puts the tip on the coordinate, and moves only the tip with an offset', () => {
    expect(pinGeometry(100, 200)).toEqual({ tipX: 100, tipY: 200, x: 100, y: 200 });
    expect(pinGeometry(100, 200, { dx: 24, dy: -10 })).toEqual({
      tipX: 124,
      tipY: 190,
      x: 100,
      y: 200,
    });
  });
});

describe('pinContains', () => {
  const g = pinGeometry(100, 200);

  it('hits a 24x28 box above the tip', () => {
    expect(pinContains(g, '', false, 100, 200)).toBe(true);
    expect(pinContains(g, '', false, 112, 174)).toBe(true);
    expect(pinContains(g, '', false, 88, 174)).toBe(true);
    expect(pinContains(g, '', false, 113, 190)).toBe(false);
    expect(pinContains(g, '', false, 100, 173)).toBe(false);
    expect(pinContains(g, '', false, 100, 203)).toBe(false);
  });

  it('hits the pill of an active home, and not the pill of a pin at rest', () => {
    const onPill = [140, 190] as const;
    expect(pinContains(g, '$585K', false, ...onPill)).toBe(false);
    expect(pinContains(pinGeometry(100, 200), '$585K', true, 100 + 20, 200 - 20)).toBe(true);
  });
});

describe('pinBounds', () => {
  it('holds the pin and the leader line to the true coordinate', () => {
    const g = pinGeometry(100, 200, { dx: 40, dy: -40 });
    const [minX, minY, maxX, maxY] = pinBounds(g, '', false);

    expect(minX).toBeLessThanOrEqual(100);
    expect(maxX).toBeGreaterThanOrEqual(140 + 12);
    expect(minY).toBeLessThanOrEqual(160 - 26);
    expect(maxY).toBeGreaterThanOrEqual(200);
  });

  it('grows to hold the pill of an active home', () => {
    const g = pinGeometry(100, 200);
    const rest = pinBounds(g, '$1,250,000', false);
    const active = pinBounds(g, '$1,250,000', true);

    expect(active[2] - active[0]).toBeGreaterThan(rest[2] - rest[0]);
  });
});

describe('drawHome', () => {
  it('draws a pin at rest with no text, and a pill with the price when active', () => {
    const rest = recorder();
    drawHome(rest.ctx, pinGeometry(100, 200), '', 'plain');
    expect(rest.calls.some(([name]) => name === 'fillText')).toBe(false);

    const active = recorder();
    drawHome(active.ctx, pinGeometry(100, 200), '$585K', 'active');
    const text = active.calls.filter(([name]) => name === 'fillText');
    expect(text).toHaveLength(1);
    expect(text[0][1][0]).toBe('$585K');
  });

  it('starts the pin at its tip, and draws a saved pin darker than a plain one', () => {
    const plain = recorder();
    const saved = recorder();
    drawHome(plain.ctx, pinGeometry(100, 200), '', 'plain');
    drawHome(saved.ctx, pinGeometry(100, 200), '', 'saved');

    expect(plain.calls.find(([name]) => name === 'moveTo')?.[1]).toEqual([100, 200]);
    const fill = (calls: Array<[string, unknown[]]>) =>
      calls.find(([name]) => name === 'set:fillStyle')?.[1][0];
    expect(fill(saved.calls)).not.toBe(fill(plain.calls));
  });

  it('draws a leader line and a dot on the true point for a fanned home', () => {
    const { ctx, calls } = recorder();
    drawHome(ctx, pinGeometry(100, 200, { dx: 24, dy: 0 }), '', 'plain');

    expect(calls.filter(([name]) => name === 'lineTo').length).toBeGreaterThanOrEqual(2);
    expect(calls.some(([name, args]) => name === 'arc' && args[0] === 100 && args[1] === 200)).toBe(
      true,
    );
  });
});
